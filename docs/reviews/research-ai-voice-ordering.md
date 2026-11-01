# Research — Urdu AI phone ordering assistant

**Date:** 2026-11-02 · **Kis liye:** restaurant ke phone/WhatsApp calls AI uthaye, Urdu mein order le, aur order seedha POS mein aaye.
**Sources:** har claim ke saath link. Jo numbers mere apne assumption hain, unhe "assumption" likha hai. "Not found" = dhoondha, nahi mila.

> **Ek line mein:** Ye **abhi possible hai**, aur Pakistan mein Urdu restaurant voice ordering ka koi commercial product nahi mila (khaali jagah). AI ka kharcha sasta hai (~$0.025–0.10 per 2-minute call). Asli mushkil do hain: **phone line ko cloud tak lana** (Twilio/Retell Pakistan mein kaam nahi karte) aur **Lahori Urdu/Punjabi + addresses ki accuracy** (kisi vendor ka phone-audio Urdu benchmark nahi). Dono ka faisla asli calls pe test se hoga, vendor claims se nahi.

---

## 1. Poora flow

```
Customer call (0300 / 042 / WhatsApp)
   │  restaurant ka number busy ya no-answer → forward
   ▼
Phone line → cloud (local SIP number / Telnyx PK number / WhatsApp Calling)
   ▼
Voice agent server (Pipecat ya LiveKit, tumhara cloud)
   ├─ Sunna:     Urdu speech-to-text
   ├─ Samajhna:  LLM + tools (search_menu, add_item, quote_order, submit_order)
   └─ Bolna:     Urdu text-to-speech
   ▼
Tumhara cloud order API  ── (wahi API jo website, QR, Foodpanda use karenge)
   ▼
Branch hub → KDS → kitchen
   +
WhatsApp pe order ka summary customer ko (confirm)
```

**Architecture point:** voice agent sirf ek aur **channel** hai. Order lene ka ek hi raasta (cloud order API + hub tak delivery) ek dafa banao — website, table QR, Foodpanda, Blink aur AI calls sab usi ko call karein. Isliye ye kaam **08 (online ordering) ke baad** aata hai, jo khud 02 (orders) aur 06 (sync) pe depend karta hai.

## 2. Kaun se third-party connections chahiye

| Kaam | Option (recommended pehle) | Kharcha | Note |
|---|---|---|---|
| **Phone line** | (a) **WhatsApp Business Calling** — customer WhatsApp pe call kare | Customer ki ki hui calls **free** ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/pricing/)) | Pakistan excluded list mein nahi; WebRTC ya SIP-over-TLS ([Meta docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling.md)) |
| | (b) **Local SIP number** — Nayatel, Zong Business Line, Wateen, Multinet | Quote only (public pricing nahi) | Licensed carriers; poochna hoga ke number tumhare apne SIP server pe point ho sakta hai ([Nayatel](https://nayatel.com/business/cloud-pbx), [Zong](https://zong.com.pk/business/zong-business-line), [Wateen](https://www.wateen.com/voice/), [Multinet](https://multinet.com.pk/?p=2321)) |
| | (c) **Telnyx Pakistan number** | From $42.50 / month + per-minute (not found) | Self-serve, SIP; Letter of Intent + address proof chahiye ([Telnyx PK](https://telnyx.com/global-coverage/pakistan), [requirements](https://support.telnyx.com/en/articles/11843465-pakistan-did-requirements)) |
| | ❌ Twilio | — | Pakistan ke voice numbers nahi ([Twilio](https://www.twilio.com/en-us/sip-trunking/pricing/pk)) |
| | ❌ Retell | — | +92 se calls 0 second mein kat jati hain ([Retell community](https://community.retellai.com/t/inbound-calls-from-pakistan-disconnect-immediately-0s-user-hangup/3591)) |
| | ❌ SIM gateway | — | PTA isi pe raids karta hai — grey traffic ([PTA](https://www.pta.gov.pk/en/media-center/single-media/pta-raid-on-voip-grey-setup--120224)) |
| **Agent framework** | **Pipecat** (BSD-2) ya **LiveKit Agents** (Apache-2.0, Node SDK) — self-host | Framework free; LiveKit Cloud $0.01/min agent ([LiveKit](https://livekit.com/pricing.md)); Pipecat Cloud $0.01/agent ([Daily](https://www.daily.co/blog/pipecat-cloud-is-now-generally-available/)) | Koi bhi SIP trunk, apni marzi ke speech providers. Hosted Vapi ($0.05/min + models) sirf testing ke liye ([DevDigest](https://www.developersdigest.tech/voice-agents/vapi)) |
| **Sunna (STT)** | **Soniox v5** | $0.12 / hour real-time ([Soniox](https://soniox.com/pricing?utm_category=ai)) | Urdu-English mid-sentence mixing ([Soniox](https://soniox.com/speech-to-text/use-cases/voice-agents/urdu)). Alternatives: AssemblyAI $0.45/hr ([AssemblyAI](https://www.assemblyai.com/languages/urdu)), Deepgram Nova-3 (Urdu, lekin mixing nahi) ([Deepgram](https://deepgram.com/learn/speech-to-text-for-hebrew-persian-urdu-on-nova-3)) |
| **Samajhna (LLM)** | Gemini 3.1 Flash-Lite (sasta) ya GPT | $0.25 in / $1.50 out per 1M tokens ([Morph](https://www.morphllm.com/gemini-api-pricing)) | Urdu knowledge benchmark pe Gemini sab se aage ([papers.cool](https://papers.cool/arxiv/2606.07167)) — ordering dialogue ka benchmark nahi |
| **Bolna (TTS)** | **Azure ur-PK** (Uzma / Asad) ya **Uplift AI** (Pakistani, desi voices) | Azure $15 per 1M characters ([Beri](https://www.beri.net/article/elevenlabs-vs-cartesia-vs-azure-tts-latency-pricing-voice-cloning-2026)); Uplift pricing not found | Uplift: $3.5 M seed, YC ([Dawn](https://www.dawn.com/news/1969895)); 8 kHz phone audio support ([Pipecat](https://docs.pipecat.ai/api-reference/server/services/tts/upliftai)). ElevenLabs ka fast model Urdu nahi bolta ([ElevenLabs](https://elevenlabs.io/docs/help-center/other/what-languages-do-you-support.md)) |
| **All-in-one (option)** | **OpenAI gpt-realtime-2.1-mini** — sunna + samajhna + bolna ek model | Audio $10 in / $20 out per 1M tokens ([OpenAI forum](https://community.openai.com/t/new-realtime-models-on-the-api-gpt-realtime-2-1-and-gpt-realtime-2-1-mini/1385896)) | Urdu supported ([MS Learn](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-language-support)); SIP support. Pakistani voice nahi chun sakte; mini pe tool-calling ki shikayat (anecdotal) |
| **Order summary** | WhatsApp Cloud API | Messaging fees | Call ke baad customer ko order + total; woh "haan" kare |
| **Tumhara apna** | Cloud order API + menu (01c) + hub delivery | — | `quote_order`, `submit_order` (ULID = idempotency key) |

## 3. Do stacks — kharcha per 2-minute call

**Assumptions (meri):** caller 1 min bole, AI 1 min; ~8 turns; ~3 000-token menu/system prompt; ~800 Urdu characters AI speech. **Phone line ka kharcha shamil nahi.** Rate: 1 USD = Rs 276.68 ([Pluang](https://pluang.com/en/tools/currency-converter/usd-pkr)).

| Stack | Kya | Per call (AI) | PKR |
|---|---|---|---|
| **A. All-in-one** | gpt-realtime-2.1-mini | ~$0.05 (range $0.04–0.10) | ~Rs 14 (Rs 11–28) |
| **A+. Flagship** | gpt-realtime-2.1 | ~$0.12–0.22 | ~Rs 33–61 |
| **B. Pipeline** | Soniox → Gemini Flash-Lite → Azure ur-PK | ~$0.025 | ~Rs 7 |

Math (Stack B): STT 2 min × $0.12/hr = $0.004; LLM 8 × 4 000 × $0.25/1M = $0.008 + output $0.001; TTS 800 × $15/1M = $0.012.
Math (Stack A): caller audio 600 × $10/1M + AI audio 1 200 × $20/1M + prompt/context ≈ $0.05 (token-per-minute figures from [Forasoft](https://www.forasoft.com/article/openai-realtime-api-pricing)).

**Correction:** pichli baat-cheet mein maine Rs 85–200 per call ka andaza diya tha. Naye pricing ke saath AI ka hissa **~Rs 7–28 per call** hai; phone line ka kharcha upar se (local SIP pricing public nahi; WhatsApp customer-initiated calls free).

**Mera mashwara:** prototype **Stack A** se (sab se jaldi banta hai), production **Stack B** pe (sasta, Pakistani voice, structured order). Faisla test se.

## 4. Latency — "insaan jaisi" baat-cheet

- Target: pehli awaaz **~800 ms** (median), p95 1 500 ms se kam; is se zyada "robotic" lagta hai ([Twig](https://www.twig.so/blog/voice-ai-agents-latency-budget-800ms)).
- Budget: caller ruka pehchanna 200–300 ms, STT 50–150, LLM pehla token 200–400, TTS pehli awaaz 100–200, network 30–80.
- Har step **streaming** hona chahiye. Uplift ka STT chunks mein hai (streaming nahi) — delay barhega ([Pipecat](https://docs.pipecat.ai/api-reference/server/services/stt/upliftai)).
- Urdu ke liye kisi vendor ne ms latency publish nahi ki — khud naapna hoga.

## 5. Urdu ke asli masle

- **Urdu-English-Punjabi mixing:** Whisper English words ko Urdu script mein badal deta ya translate kar deta hai ([arXiv 2605.17846](https://arxiv.org/pdf/2605.17846)). Soniox mixing ka daawa karta hai.
- **Numbers aur addresses:** phone pe Urdu ke beech English numbers mushkil ([arXiv 2307.12759](https://arxiv.org/abs/2307.12759v1)); duniya bhar mein restaurant AI ki sab se bari ghalti address hai ("third floor" → "first floor") ([Flipdish](https://www.flipdish.com/resources/blog/phone-order-accuracy-in-2026-reduce-errors-with-ai)).
- **Accuracy ka koi bharosemand benchmark nahi:** FLEURS Urdu pe ElevenLabs Scribe 14.4% WER vs Whisper-v3 46.6% ([ElevenLabs](https://elevenlabs.io/speech-to-text/urdu)) — saaf audio pe, vendor ka apna. Noisy Lahori phone calls ka data: not found.
- **Dish names:** paye, nihari, siri, maghaz — menu ko LLM ko **structured tools** ke zariye do (item IDs), poora menu prompt mein mat thoko.

## 6. Design checklist (duniya ke restaurant voice products se)

- [ ] Menu **structured data** ke taur pe tools mein: `search_menu`, `add_item`, `quote_order`, `submit_order`. Price POS se, AI se nahi. Bure menu data se zyada tar deployments fail hote hain ([RaftLabs](https://www.raftlabs.com/blog/voice-ai-restaurant-phone-orders)).
- [ ] Zaroori choices (size, half/full, extras) agle item se pehle poochho ([Maple](https://help.maple.inc/articles/6848817710-ai-phone-ordering-overview)).
- [ ] **Readback:** items, choices, address, total, payment — "haan" ke baad hi `submit_order` ([Flipdish](https://www.flipdish.com/resources/blog/phone-order-accuracy-in-2026-reduce-errors-with-ai)).
- [ ] Address: landmark, block, gali, floor. Caller ka number se purana address suggest karo.
- [ ] Call ke baad **WhatsApp summary** (COD Pakistan mein normal hai).
- [ ] Upsell zyada se zyada 1–2 dafa ([Kea](https://kea.ai/resources/best-ai-phone-answering-service-restaurants-upsells-modifiers)).
- [ ] **Insaan ko transfer:** shikayat, catering, bara order, ya AI confuse ho. Ghalat confident jawab se behtar insaan ([RaftLabs](https://www.raftlabs.com/blog/voice-ai-restaurant-phone-orders)).
- [ ] Rush mein: "abhi bohot calls hain, ye link WhatsApp pe bhej raha hoon" — website ordering link.
- [ ] `submit_order` idempotent (call shuru hote hi ULID); POS/hub down ho to order queue, aur AI customer ko sach bataye.
- [ ] Pehle **doosre number pe ~2 hafte soft launch** ([RaftLabs](https://www.raftlabs.com/blog/voice-ai-restaurant-phone-orders)).
- [ ] Shuru mein **"overflow mode":** insaan pehle uthaye; busy / no-answer pe AI.

## 7. Qanoon (lawyer se confirm karo — ye legal advice nahi)

- **Recording:** Pakistan mein call record karne ke liye sab parties ki ijazat; PECA §19 mein 2 saal tak / Rs 5 lakh tak; March 2026 Supreme Court: chhup ke recording privacy ki khilaf warzi ([RecordingLaw](https://www.recordinglaw.com/world-laws/world-recording-laws/pakistan-recording-laws/)) — secondary source.
- **AI disclosure:** Pakistan mein koi rule nahi mila; EU AI Act aur US mein lazmi ([Famulor](https://www.famulor.io/blog/eu-ai-act-article-50-what-your-ai-phone-agent-must-say), [JustCall](https://justcall.io/blog/ai-voice-agent-disclosure-laws.html)). Best practice: shuru mein batao.
- **Greeting (draft):** "Assalam o Alaikum, Arif Chatkhara ki AI assistant bol rahi hoon. Ye call record ho sakti hai. Order ke liye bataiye, ya kisi insaan se baat ke liye 'insaan' kahiye."
- **PTA:** naye voice CVAS licenses band hain ([PTA](https://pta.gov.pk/en/class-vas-licenses)) — apna license nahi, licensed carrier (Nayatel/Zong/Wateen) ka number lo. SIP ports sirf authorised operators ke liye ([PTA](https://pta.gov.pk/category/no-legal-voice-ports-blocked-317315558-2023-06-01)). Apne number ko licensed carrier ke SIP number pe forward karna — explicit PTA ruling nahi mili; licensed carrier wala raasta sab se mehfooz (inference).
- **Data protection bill:** abhi qanoon nahi bana ([Friday Times](https://www.thefridaytimes.com/11-Dec-2025/data-privacy-peril-pakistan-s-legal-vacuum-consequences)).

## 8. Market aur pricing

**Pakistan:** Urdu restaurant voice ordering ka commercial product **nahi mila** (sirf IBA ka student project) ([IBA](https://ir.iba.edu.pk/research-projects-msds/49)). India ka Edesy Urdu restaurant bot ₹4–6/min ([Edesy](https://edesy.in/restaurant-order-bot/languages/urdu)). Blink ke paas voice AI: not found.

**Duniya mein restaurants kya dete hain:**

| Product | Price |
|---|---|
| Hostie | $99 / month / location ([Hostie](https://hostie.ai/resources/slang-ai-vs-maple-voice-vs-hostie-ai-2025-pricing-features-roi-multi-unit-restaurants)) |
| Loman | ~$199+ / month ([CloudTalk](https://www.cloudtalk.io/blog/loman-ai-pricing/)) |
| Kea | ~$350 / month flat ([Kea](https://kea.ai/blog/how-much-does-voice-ai-cost-a-transparent-breakdown-from-kea-ai)) |
| Slang.ai | $399–599 per location ([Slang](https://slang.ai/pricing)) |
| ConverseNow | $9.99 per order ([Stork](https://www.stork.ai/compare/conversenow-vs-voiceplug)) |

**Tumhare liye suggested pricing (assumption, test ke baad tay karo):** add-on **Rs 4 000–6 000 / month per branch, ~300 calls shamil**, uske baad **Rs 15 per call**.
Kharcha: Stack B ~Rs 7 + phone line per call. 300 calls ≈ Rs 2 100 AI + phone line → achha margin, lekin phone line ka asal rate pehle lo.

## 9. Pilot plan — step by step

| Step | Kya | Kab | Done jab |
|---|---|---|---|
| 0 | **Data:** Arif Chatkhara ki ~50 asli order calls record karo (**customer se ijazat ke saath**) — dish names, addresses, numbers | Abhi (code ki zaroorat nahi) | 50 recordings + likha hua sahi order |
| 1 | **Accuracy test:** in calls ko Soniox, AssemblyAI, Deepgram, Uplift, aur gpt-realtime-mini pe chalao; har ek ka items/address sahi % naapo | 1 weekend | Ek STT chuna, numbers ke saath |
| 2 | **Phone line quotes:** Nayatel + Zong Business Line se ek Lahore number + 2–4 channels; likh ke poochho: "apne SIP server pe route, kaunse IPs/codecs, PTA whitelisting?"; fallback Telnyx | Parallel | Ek carrier tay |
| 3 | **Prototype:** Pipecat/LiveKit + Stack A; tools: `search_menu`, `quote_order`, `submit_order` (01c menu se) | 08 order API ke baad | Test number pe end-to-end order |
| 4 | **WhatsApp calling + voice notes** pe pehla live test (free, license nahi) | Prototype ke baad | 2 hafte, X orders, error % |
| 5 | **Overflow mode** asli number pe: busy/no-answer → AI | Step 4 theek ho to | Staff ka load kam, complaints nahi |
| 6 | Stack B pe shift (sasta, Pakistani voice) | Volume aane pe | Per call cost < Rs 10 |

**Sequence reminder:** step 0–2 abhi ho sakte hain (data + quotes, code nahi). Step 3 se aage **02 orders → 06 sync → 08 order API** ke baad.

## 10. Jo nahi mila

Pakistani SIP trunk prices (Nayatel/Zong/PTCL), PTCL forwarding, Telnyx per-minute Pakistan rate, WhatsApp business-initiated call rate Pakistan, Uplift AI pricing, noisy phone-audio Urdu accuracy ka independent benchmark, Gemini Live mein Urdu, ms-level Urdu latency.
