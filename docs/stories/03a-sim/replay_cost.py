"""Throwaway drill: cost of a full-day replay when every OrderPlaced re-plans
the unfired reservations on its stations (03a-g0 D13). Not product code.
Python; Node is several times faster, so this is a pessimistic bound.

Lesson from v1 of this file: a naive interval scan is O(n^4) per re-plan and
never finishes a day. The engine must keep an occupancy PROFILE per station
(sorted segments of concurrent count) and place items against it: O(n * m).
"""
import random, time, bisect

DAY = 18 * 3600
ORDERS = 2000
# station: (capacity, cook s). Two tandoors = 60 wall slots. Sized ~1.3x peak demand.
STATIONS = {'tandoor': (60, 180), 'karahi': (50, 1200), 'bbq': (30, 900), 'degh': (1000, 60), 'tawa': (8, 300)}
MENU = [('tandoor', 3.0), ('karahi', 0.6), ('bbq', 0.4), ('degh', 0.5), ('tawa', 0.3)]  # avg lines per order
KEEP = 60          # freeze window (s): a line starting within KEEP of now is fixed
STEP = 30
MAX_EARLY = 60     # max_early_ms default (01a A-11, 60 000 ms): a held line never starts before latest - MAX_EARLY
PRUNE = True       # 03a v0.5 (G4-1 #1): pivot = the new lines' earliest possible start against the fixed lines

def rush_times(seed):
    r = random.Random(seed); ts = []
    for _ in range(ORDERS):
        u = r.random()
        if u < 0.65:  t = r.gauss(13 * 3600, 9000)     # dinner, ~5 h, ~260 orders/h at peak
        elif u < 0.9: t = r.gauss(6 * 3600, 3600)
        else:         t = r.uniform(0, DAY)
        ts.append(min(max(t, 0), DAY))
    return sorted(ts)

class Res:
    __slots__ = ('item', 'start', 'end', 'target', 'cook', 'fired')
    def __init__(s, item, target, cook):
        s.item, s.target, s.cook, s.fired = item, target, cook, False
        s.start = s.end = None

class Profile:
    """Occupancy as sorted boundaries; count(t) = number of intervals covering t."""
    def __init__(s, intervals):
        pts = {}
        for a, b in intervals:
            pts[a] = pts.get(a, 0) + 1; pts[b] = pts.get(b, 0) - 1
        s.t = sorted(pts); s.c = []; run = 0
        for x in s.t: run += pts[x]; s.c.append(run)
    def max_in(s, a, b):
        """max occupancy over [a, b)"""
        i = bisect.bisect_right(s.t, a) - 1
        m = s.c[i] if i >= 0 else 0
        j = i + 1
        while j < len(s.t) and s.t[j] < b:
            if s.c[j] > m: m = s.c[j]
            j += 1
        return m
    def add(s, a, b):
        for x, d in ((a, 1), (b, -1)):
            i = bisect.bisect_left(s.t, x)
            if i < len(s.t) and s.t[i] == x:
                for k in range(i, len(s.c)): s.c[k] += d
            else:
                prev = s.c[i - 1] if i > 0 else 0
                s.t.insert(i, x); s.c.insert(i, prev + d)
                for k in range(i + 1, len(s.c)): s.c[k] += d

class Station:
    def __init__(s, cap, cook):
        s.cap, s.cook, s.res = cap, cook, []
    def place(s, r, now, prof):
        latest = max(r.target - r.cook, now)
        t = latest
        while t >= now:                                   # hold-and-fire: latest feasible start
            if prof.max_in(t, t + r.cook) < s.cap: break
            t -= STEP
        else:
            t = now                                       # late: earliest fit after now
            while prof.max_in(t, t + r.cook) >= s.cap: t += STEP
        r.start, r.end = t, t + r.cook; prof.add(t, t + r.cook)
    def earliest_possible(s, r, now, prof):
        """03a v0.5 pivot: earliest start the new line may take (never before latest - MAX_EARLY) against fixed lines."""
        t = max(now, r.target - r.cook - MAX_EARLY)
        while prof.max_in(t, t + r.cook) >= s.cap: t += STEP
        return t
    def replan(s, now, new_items=()):
        frozen = lambda r: r.fired or (r.start is not None and r.start - now <= KEEP)
        fixed = [r for r in s.res if frozen(r)]
        if PRUNE and new_items:
            base = Profile([(r.start, r.end) for r in fixed])
            pivot = min(s.earliest_possible(r, now, base) for r in new_items)
            new_ids = {r.item for r in new_items}
            fixed += [r for r in s.res if not frozen(r) and r.item not in new_ids and r.end <= pivot]
        fixed_ids = {r.item for r in fixed}
        free = sorted((r for r in s.res if r.item not in fixed_ids), key=lambda r: (r.target, r.item))
        prof = Profile([(r.start, r.end) for r in fixed])
        for r in free: s.place(r, now, prof)
        return len(free)
    def fire_due(s, now):
        n = 0
        for r in s.res:
            if not r.fired and r.start <= now: r.fired = True; n += 1
        return n
    def done_before(s, now):
        before = len(s.res); s.res = [r for r in s.res if not (r.fired and r.end <= now)]
        return before - len(s.res)

def run(seed=7):
    r = random.Random(seed)
    st = {k: Station(*v) for k, v in STATIONS.items()}
    events = 0; replan_ms = []; max_free = 0; item = 0; late = 0; counts = []
    t0 = time.perf_counter()
    for t in rush_times(seed):
        for s in st.values():
            events += s.fire_due(t) * 2 + s.done_before(t) * 2
        lines = []
        for name, avg in MENU:
            n = r.choices([0, 1, 2, 3, 4, 6], [max(0.01, 1 - avg / 1.6), 1, avg / 2, avg / 3, avg / 5, avg / 8])[0]
            lines += [name] * n
        if not lines: lines = ['tandoor']
        target = t + max(STATIONS[n][1] for n in lines) + 300
        touched = {}
        for name in lines:
            item += 1; x = Res(item, target, STATIONS[name][1]); st[name].res.append(x); touched.setdefault(name, []).append(x)
        events += 1 + len(lines)
        a = time.perf_counter()
        for name, new in touched.items():
            c = st[name].replan(t, new); counts.append(c); max_free = max(max_free, c)
        replan_ms.append((time.perf_counter() - a) * 1000)
        late += sum(1 for name in touched for x in st[name].res if x.end > x.target and not x.fired)
    total = time.perf_counter() - t0
    replan_ms.sort()
    print(f'orders {ORDERS}, events replayed ≈ {events}, items {item}')
    print(f'full-day replay (Python): {total:.1f} s; re-plan p50 {replan_ms[len(replan_ms)//2]:.2f} ms, '
          f'p99 {replan_ms[int(len(replan_ms)*0.99)]:.1f} ms, max {replan_ms[-1]:.1f} ms')
    counts.sort()
    print(f'max unfired reservations re-planned on one station at once: {max_free}')
    print(f're-placed per station re-plan: p50 {counts[len(counts)//2]}, p99 {counts[int(len(counts)*0.99)]}, max {counts[-1]}')
    print(f'late unfired lines summed over submits: {late}')

if __name__ == '__main__':
    import sys
    if '--no-prune' in sys.argv: PRUNE = False
    print(f'PRUNE={PRUNE} KEEP={KEEP}s MAX_EARLY={MAX_EARLY}s')
    run()
