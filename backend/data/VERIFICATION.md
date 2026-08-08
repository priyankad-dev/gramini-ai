# Scheme data — verification log

**Status: PARTIAL. `data_status` is still `"sample"` and must stay that way until a
human opens each portal.** Read the last section before you demo.

Last research pass: **6 August 2026.**

---

## How to read this

There were two passes. The first ran through a fetch service outside India and could
reach almost nothing. The second ran from the project machine **in India**, which reaches
the portals that block overseas traffic — that is how NSAP, Soil Health Card and PMAY-G
got properly verified. If you re-check anything, do it from a machine in India.

Facts below are marked by how they were actually established:

- **PORTAL** — read directly off the scheme's own website.
- **PIB** — Press Information Bureau / ministry press releases (the government's own
  publications, but not the scheme portal).
- **UNCHECKED** — could not be confirmed this pass. Still as originally written.

A **PIB** mark is good evidence. It is *not* the same as "we opened the portal and read
the eligibility line", which is what the judges will ask about.

---

## Corrections made this pass

### 1. MGNREGA — official link was dead ⚠️

`nrega.nic.in` now serves only a redirect notice. Clicking the citation during the demo
would have shown a bare "This Website is Redirected to…" page.

- **Was:** `https://nrega.nic.in/`
- **Now:** `https://nrega.dord.gov.in/` — **PORTAL**

### 2. Ayushman Bharat — eligibility was incomplete, in the way that matters most ⚠️

The data said eligibility comes from the SECC list. Since **29 October 2024**, every
person aged **70 or above** is covered for ₹5 lakh a year regardless of income, under the
Ayushman Vay Vandana Card. If they are already in a PM-JAY family, the 70+ member gets a
separate ₹5 lakh on top.

The app is aimed at elderly rural users. The old wording would have told exactly the
person in our demo video to go check a list she is not on — when she qualifies
automatically. Corrected in all three languages. — **PIB**

Also added the keyword *वय वंदना / vay vandana* so the scheme is findable by that name.

### 3. PMAY-G — eligibility list was stale

SECC 2011 is no longer the only route. The Union Cabinet (09.08.2024) approved modified
exclusion criteria, and identification now runs through the **Awaas+ 2024** survey
(mobile app launched 17.09.2024) alongside the remaining SECC permanent wait list. The
old criteria on two-wheelers, fishing boats, landline phones and refrigerators were
deleted. — **PIB**

### 4. PMAY-G — added the actual amounts

Was vague ("financial help… in instalments"). Now: **₹1.20 lakh** in plain areas,
**₹1.30 lakh** in hilly/difficult/IAP areas, plus **₹12,000** for a toilet via SBM-G and
**90–95 days** of MGNREGA wages. — **PIB**

### 5. PMFBY — we were describing a free payout ⚠️

The old text said the insurance company pays for crop loss and never mentioned that the
farmer pays a premium at all. Added: **2%** kharif, **1.5%** rabi, **5%** commercial and
horticultural crops; government pays the balance. Several states waive the farmer share.
— **PIB**

### 6. NSAP — vague age rule made concrete

Was "the age condition is different for each category". Now states it: old age **60+**,
widow **40+**, disability **18+**, all BPL. Central amounts (₹200/month to 79, ₹500 from
80; widow ₹300 then ₹500) were found but **deliberately left out of the app** — states
top this up by very different amounts, so a single number would mislead. The existing
"the amount differs from state to state" line is the honest answer. — **PIB**

---

## Confirmed correct, no change needed

### PM-KISAN — **PORTAL** ✅

The only scheme whose own portal was readable. Verified directly on pmkisan.gov.in:

- ₹6,000 per year in three equal instalments to land-holding farmer families ✅
- Exclusions confirmed and *more* specific than our text: institutional landholders,
  government employees (except Group D / Class IV), constitutional office holders,
  pensioners drawing ₹10,000+/month, income-tax payers, practising professionals
- Helpline **155261** confirmed as the 24×7 IVRS line ✅ (`1800-11-5526` also appears)

### MGNREGA content — **PIB** ✅

100 days per rural household per year, work within 15 days of demand, unemployment
allowance otherwise. These are statutory guarantees in the Act, so they are stable.

### KCC — **PIB**, text left deliberately vague ✅

Our text says "low-interest loan, discount for repaying on time" and stops there. That
is correct and safe. The specifics found — 7% base with 1.5% subvention, 3% prompt
repayment incentive bringing it to an effective 4%, collateral-free limit raised to
₹2 lakh from 01.01.2025, MISS crop loan limit raised ₹3→₹5 lakh — were **not** put in
the app, because interest subvention is renewed financial year by financial year and a
stale rate is worse than no rate.

---

---

## Portal pass — 6 August 2026

Re-run from the project machine, which reaches portals that block overseas traffic.
Three more schemes are now **PORTAL**-verified, and two of them needed corrections.

### NSAP — now PORTAL ✅, and our ages were wrong ⚠️

Read from the FAQ on `nsap.dord.gov.in`. NSAP has five components; ours covers the two
pension ones. Confirmed: **BPL family is required**, and

| Component | Age | Our old text said |
|---|---|---|
| Old age (IGNOAPS) | **60 or above** ✅ | 60 or above ✅ |
| Widow (IGNWPS) | **40 to 59** | "40 or above" ❌ |
| Disability (IGNDPS) | **18 to 59**, severe or multiple disability | "18 or above", no severity condition ❌ |

A widow moves onto the old age pension at 60 — she does not stay on widow pension — so
"40 or above" described a scheme that does not exist. The severity condition was missing
entirely, which would have told a person with a mild disability they qualify. Both fixed,
and the transition at 60 is now stated.

Central amounts (IGNOAPS ₹200/month to 79 then ₹500; IGNWPS and IGNDPS ₹200 central with
states adding at least as much again) are on the portal but **still deliberately left out
of the app** — the portal itself says old-age beneficiaries actually receive anywhere
between ₹200 and ₹1,000 depending on the state. "It differs from state to state" remains
the only honest single sentence.

### Soil Health Card — now PORTAL ✅, application route corrected

The portal is a JavaScript app, but its FAQ text ships inside the bundle. Confirmed:

- **"It is free of cost for the farmer"** ✅ — the ₹300 per sample is borne by the scheme
- The card reports **12 parameters** (N, P, K; S; Zn, Fe, Cu, Mn, B; pH, EC, OC) and gives
  both **crop** and **fertiliser dosage** recommendations ✅
- Route: request through the **district or state nodal officer** or apply on the portal;
  an agent visits, geo-tags the land and collects the sample — or the farmer takes a
  sample to the assigned lab. The lab makes contact within 2–3 working days.

Our text said "agriculture department officer **or the nearest Krishi Vigyan Kendra**".
KVK appears nowhere in the portal's own description, so it was replaced with the nodal
officer and portal route. Added the 12 measures and the crop recommendation.

### PMAY-G — eligibility route confirmed current ✅

The portal carries a circular dated **10.07.2026** extending timelines for the **Awaas+
2024 household survey**, and exposes both "SECC Family Member Details" and "AwaasPlus
Beneficiary Details" lookups. So the corrected eligibility text is right and still live —
this is not a change that has since been superseded.

The ₹1.20 / ₹1.30 lakh figures remain **PIB**-level; they are not on the portal's
server-rendered pages.

---

## ⚠️ Maharashtra: the ₹1 crop insurance scheme has ENDED

Relevant because the demo audience is Marathi-speaking and someone in the room will
remember this scheme.

Maharashtra's *Ek Rupayat Pik Vima* — where the state paid the whole premium and the
farmer paid ₹1 — ran from Kharif 2023-24 and was **discontinued by state cabinet decision
on 29 April 2025**, reportedly after fake registrations and a registration scam. From
Rabi 2025 the **standard PMFBY rates apply in Maharashtra**: 2% kharif, 1.5% rabi, 5%
horticultural/commercial.

So the premium line now in `schemes.json` is correct for Maharashtra. Two things follow:

1. **Do not** say "in Maharashtra it costs ₹1" — that stopped being true in 2025.
2. If a mentor or judge says "isn't crop insurance ₹1 here?", the answer is: it was, for
   two seasons, and it ended in April 2025.

**Source quality: secondary.** This comes from Marathi agriculture news sites, not from a
government portal — the state cabinet decision itself was not reachable. Confirm before
you say it on stage.

---

## Still UNCHECKED — needs a browser, ~5 minutes

These three portals cannot be read by any automated tool. `pmjay.gov.in` refuses
connections at network level even with a complete Chrome header set; PMFBY, myScheme and
all NHA properties render content only after JavaScript executes. Server-side fetching,
SPA-bundle extraction and the Next.js data endpoint were all tried and all failed.

Open each in Chrome and check exactly this:

| # | Open | Look for | Our data says |
|---|---|---|---|
| 1 | `pmjay.gov.in` | Does the **70+ / Vay Vandana** rule appear, and is SECC still the route for everyone else? | "Everyone 70 or above is covered whatever their income; for other families eligibility comes from the SECC list" |
| 2 | `pmjay.gov.in` | Is the cover still **₹5 lakh per family per year**? | ₹5 lakh |
| 3 | `pmfby.gov.in` | Farmer premium: **2% kharif / 1.5% rabi / 5% commercial+horticultural** | exactly those three |
| 4 | `myscheme.gov.in/schemes/kcc` | Does the page load at all? Is it still the right page for KCC? | used as the `official_link` |
| 5 | PMAY-G guidelines PDF on `pmayg.dord.gov.in` | **₹1.20 lakh** plain / **₹1.30 lakh** hilly | exactly those |
| 6 | Ring **1800-11-6446** | Does it answer as PMAY-G? | removed from the app; restore if it answers |

If 1–5 all match, set each scheme's `verified_on` to the date and flip `data_status` to
`"verified"`. That is the last thing standing between the app and an honest green light.
| **Helplines** | Done — see the helpline section below. Only PMAY-G is unresolved. |
| **All `official_link`s** | Reachability now machine-checked (below), but open each in a browser to confirm it renders. `myscheme.gov.in/schemes/kcc` is a JavaScript app. |
| **`papers_needed`** | Not verified for any scheme. Portals list documents inconsistently. |

---

## Helpline pass — 6 August 2026

Checked from the project machine (in India), so portals that block overseas traffic were
reachable. One number was **wrong**, one could not be sourced at all.

| Scheme | Number | Status |
|---|---|---|
| NSAP | **1800-111-555** | **PORTAL** ✅ — read off `nsap.dord.gov.in` contact page |
| PMFBY | **14447** | **PIB** ✅ — the Krishi Rakshak Portal & Helpline, announced by name. WhatsApp bot `7065514447` also exists |
| Ayushman | **14555** | **PIB/NHA** ✅ — National Call Centre; `1800-111-565` is the same desk |
| PM-KISAN | **155261** | **PIB** ✅ — 24×7 IVRS. `1800-11-5526` also published |
| KCC + Soil Health | **1800-180-1551** | **PIB** ✅ — but see the caveat below |
| MGNREGA | **1800-110-707** | **CORRECTED** ⚠️ — was `1800-111-555` |
| PMAY-G | *(removed)* | **UNSOURCED** ⚠️ |

### MGNREGA had the wrong number ⚠️

The data listed `1800-111-555` for MGNREGA. That number is real, but it belongs to
**NSAP** — it is NSAP's technical support line, and it is printed on NSAP's own contact
page. Both schemes sit under the Ministry of Rural Development, which is presumably how
it got copied across.

Replaced with **1800-110-707**, the Ministry's toll-free national helpline for MGNREGA
complaints and worker-entitlement queries (PIB release on MGNREGS grievance redressal,
also carried by Vikaspedia and UMANG). Confirm on `nrega.dord.gov.in` in a browser.

### PMAY-G — number removed, not replaced ⚠️

`1800-11-6446` is widely published on aggregator sites but appears on **no government
source** I could reach. The Ministry's own posted number, `1800-110-111`, is a helpdesk
for *PMAY-G staff* with survey-app and login problems — not a line for villagers.

So the field is now `null` and the UI simply hides the row (`SchemeCard.jsx` already
guards on it). The scheme's `how_to_apply` already points to the gram panchayat, which is
the officially documented grievance route. **Ring 1800-11-6446. If it answers as PMAY-G,
put it back** — the old value is kept in `_helpline_note` in the JSON.

### Caveat on 1800-180-1551

Correct and current, but it is the **Kisan Call Centre** — a general agriculture helpline
in 22 languages, open 06:00–22:00, not a 24×7 line and not specific to KCC or Soil Health
Card. It is the right number to give a farmer; just do not describe it on stage as "the
KCC helpline".

---

## Link pass — two more dead portals found

Every `official_link` was requested from the project machine:

| URL | Result |
|---|---|
| `pmayg.nic.in` | **DEAD** — does not resolve. Was our PMAY-G link → now `pmayg.dord.gov.in` ✅ |
| `nsap.nic.in` | **DEAD** — does not resolve. Was our NSAP link → now `nsap.dord.gov.in` ✅ |
| `nrega.nic.in` | Serves only a redirect notice → now `nrega.dord.gov.in` ✅ |
| `pmkisan.gov.in`, `pmfby.gov.in`, `soilhealth.dac.gov.in`, `myscheme.gov.in/schemes/kcc` | 200 ✅ |
| `pmjay.gov.in` | Returns nothing to any automated client — a WAF block, not an outage. **Open it in Chrome to confirm.** Left unchanged. `nha.gov.in/PM-JAY` is a working alternative if it turns out to be down. |

Three of eight scheme portals had migrated off `*.nic.in` to `*.dord.gov.in` (all three
Rural Development schemes). If a fourth link fails on the day, try that pattern first.

## Why `data_status` is still `"sample"`

The amber warning strip stays up. Flipping the flag means *"a person on this team opened
the government website and read every line"* — and that has not happened yet for six of
the eight schemes.

The plan itself says judges will ask whether you really checked. Setting the flag on the
strength of press releases, then being asked "so you opened pmjay.gov.in?", is a worse
position than showing the amber strip and saying which six still need a pass. Do the
portal pass, set each `verified_on`, then flip it.
