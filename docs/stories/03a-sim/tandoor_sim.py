"""Throwaway drill: one tandoor (slot station), three dispatch policies.
Not product code. Numbers are for comparing policies, not for quoting."""
import random, statistics as st

COOK = 180            # naan cook time (s)
STEP = 5              # sim step (s)
RUSH = 2 * 3600       # 2 h rush
WEIGHT = {'dine': 1, 'take': 2, 'follow': 3}

class Item:
    __slots__ = ('oid','otype','submit','target','promise','fired','done','main_ready')
    def __init__(s, oid, otype, submit, target, promise, main_ready=None):
        s.oid, s.otype, s.submit, s.target, s.promise = oid, otype, submit, target, promise
        s.fired = s.done = None; s.main_ready = main_ready

def gen_orders(rate_per_h, seed):
    r = random.Random(seed); t = 0; orders = []
    while t < RUSH:
        t += r.expovariate(rate_per_h / 3600)
        x = r.random()
        if x < 0.55:   otype, n = 'dine', r.choice([2,3,4,4,6,8])
        elif x < 0.88: otype, n = 'take', r.choice([1,2,2,4])
        else:          otype, n = 'follow', r.choice([1,2])
        main = t + r.choice([900, 1200, 1500]) if otype == 'dine' else None  # karahi 15–25 min
        orders.append((t, otype, n, main))
    return orders

def run(policy, orders, cap, max_early, keep, padding):
    pending, cooking, done = [], [], []
    oi = 0; busy_at = {}
    now = 0
    def quote(now):  # crude ETA: queue ahead / capacity
        ahead = len(cooking) + sum(1 for i in pending if i.target - COOK - now <= max_early)
        return now + COOK + max(0, (ahead - cap + 1) // cap) * COOK
    while now < RUSH + 3600:
        while oi < len(orders) and orders[oi][0] <= now:
            t, otype, n, main = orders[oi]; oi += 1
            if otype == 'dine': target = main            # sync with karahi
            else:               target = quote(now)      # engine target
            promise = target + padding                   # what customer is told
            for _ in range(n):
                pending.append(Item(oi, otype, t, target, promise, main))
        # finish
        for it in cooking[:]:
            if it.fired + COOK <= now:
                it.done = now; cooking.remove(it); done.append(it)
        # dispatch
        while len(cooking) < cap and pending:
            if policy == 'fifo':
                pick = min(pending, key=lambda i: i.submit)
            else:
                slack = {id(i): i.target - COOK - now for i in pending}
                urgent = [i for i in pending if slack[id(i)] <= keep]
                if urgent:
                    pick = min(urgent, key=lambda i: i.target - (0 if policy=='edf' else (WEIGHT[i.otype]-1)*120))
                else:
                    elig = [i for i in pending if slack[id(i)] <= max_early]
                    if not elig: break                     # hold: nothing should fire yet
                    if policy == 'edf': pick = min(elig, key=lambda i: i.target)
                    else: pick = max(elig, key=lambda i: WEIGHT[i.otype] * (now - i.submit + 1))
            pick.fired = now; cooking.append(pick); pending.remove(pick)
        now += STEP
    return done

def report(done, label):
    by = {}
    for it in done: by.setdefault(it.otype, []).append(it)
    out = [f'{label:34}']
    for k in ('dine','take','follow'):
        xs = by.get(k, [])
        if not xs: continue
        late = [max(0, i.done - i.promise) for i in xs]
        pct = 100 * sum(1 for l in late if l > 0) / len(xs)
        if k == 'dine':
            cold = [max(0, i.main_ready - i.done) for i in xs]
            out.append(f'dine late {pct:4.0f}% max {max(late)/60:4.1f}m cold {st.mean(cold)/60:4.1f}m')
        else:
            wait = [(i.done - i.submit)/60 for i in xs]
            out.append(f'{k:6} late {pct:4.0f}% max {max(late)/60:4.1f}m wait {st.mean(wait):4.1f}m')
    return ' | '.join(out)

if __name__ == '__main__':
    CAP = 10   # 10 naan at once → 200/h
    for rate, name in ((40,'LIGHT 40/h ~65% busy'), (55,'NORMAL 55/h ~90% busy'), (62,'PEAK 62/h ~100% busy'), (75,'OVERLOAD 75/h ~125%')):
        print(f'\n=== {name} (tandoor cap {CAP}, ~{rate*3.3:.0f} naan/h) ===')
        orders = gen_orders(rate, seed=7)
        print(report(run('fifo', orders, CAP, 60, 0, 0),      'FIFO (aaj ka tareeqa)'))
        print(report(run('edf',  orders, CAP, 60, 0, 0),      'EDF, no keep/pad'))
        print(report(run('wg',   orders, CAP, 60, 0, 0),      'Waada Guard, no keep/pad'))
        print(report(run('wg',   orders, CAP, 60, 60, 180),   'Waada Guard + keep 60s + pad 3m'))
