"""Guard rail for the scheme matcher.

Run it after ANY edit to data/schemes.json:

    .venv\\Scripts\\python.exe test_schemes.py

Adding a keyword is the easiest way to break this app's one promise. A keyword
that is too broad ("paisa", "yojana", "madad") starts matching questions it was
never meant to, and the app answers a laptop question with crop insurance -
confidently, with a government link under it. That is the exact failure this
project exists to avoid, so it is checked mechanically rather than by eye.

Stdlib only, no pytest, so it runs on the demo laptop with nothing installed.
"""

from __future__ import annotations

import sys

import schemes

# Things a villager would really say, and the scheme they mean.
MUST_MATCH: list[tuple[str, str, str]] = [
    ("मुझे किसान की योजना बताओ", "hi", "pm-kisan"),
    ("किसान सम्मान निधि के बारे में बताइए", "hi", "pm-kisan"),
    ("फसल खराब हो गई है", "hi", "pmfby"),
    ("फसल बीमा कैसे मिलेगा", "hi", "pmfby"),
    ("मुफ्त इलाज कहाँ मिलेगा", "hi", "ayushman-bharat"),
    ("आयुष्मान कार्ड कैसे बनेगा", "hi", "ayushman-bharat"),
    ("खेती के लिए लोन चाहिए", "hi", "kcc"),
    ("किसान क्रेडिट कार्ड", "hi", "kcc"),
    ("पक्का घर बनाने की योजना", "hi", "pmay-g"),
    ("मुझे मकान चाहिए", "hi", "pmay-g"),
    ("मिट्टी की जाँच कहाँ होगी", "hi", "soil-health-card"),
    ("जॉब कार्ड कैसे बनता है", "hi", "mgnrega"),
    ("गाँव में काम चाहिए", "hi", "mgnrega"),
    ("बुढ़ापा पेंशन कैसे मिलेगी", "hi", "nsap-pension"),
    ("विधवा पेंशन", "hi", "nsap-pension"),
    ("tell me about farmer scheme", "en", "pm-kisan"),
    ("i need a loan for my crop", "en", "kcc"),
    ("free treatment in hospital", "en", "ayushman-bharat"),
    ("how do i get a pucca house", "en", "pmay-g"),
    ("old age pension", "en", "nsap-pension"),
    ("soil test for my field", "en", "soil-health-card"),
    ("मला मोफत उपचाराची योजना सांग", "mr", "ayushman-bharat"),
    ("शेतकरी सन्मान योजना", "mr", "pm-kisan"),
    ("पीक विमा", "mr", "pmfby"),
    ("घरकुल योजना", "mr", "pmay-g"),
]

# Real questions we have NO checked data for. Saying "I do not know" is the
# correct answer to every one of these. Returning the least-wrong scheme is not.
MUST_REFUSE: list[tuple[str, str]] = [
    ("मुझे लैपटॉप के लिए सरकारी पैसा चाहिए", "hi"),
    ("लैपटॉप सब्सिडी", "hi"),
    ("laptop subsidy for students", "en"),
    ("मुझे स्कूटी चाहिए सरकारी योजना से", "hi"),
    ("बिजली का बिल माफ करने की योजना", "hi"),
    ("मुझे पैसा चाहिए", "hi"),
    ("सरकारी नौकरी कैसे मिलेगी", "hi"),
    ("मोबाइल फोन मुफ्त मिलेगा क्या", "hi"),
    ("shadi ke liye paisa", "hi"),
    ("free wifi scheme", "en"),
    ("student scholarship for college", "en"),
    ("मला लॅपटॉप हवा आहे", "mr"),
]


def main() -> int:
    failures = 0

    print("--- must match ---")
    for query, lang, expected in MUST_MATCH:
        found = schemes.search(query, lang)
        top = found[0]["id"] if found else None
        ok = top == expected
        failures += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {query[:42]:44s} -> {top} (want {expected})")

    print("--- must refuse ---")
    for query, lang in MUST_REFUSE:
        found = schemes.search(query, lang)
        top = found[0]["id"] if found else None
        ok = top is None
        failures += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {query[:42]:44s} -> {top or 'refused'}")

    total = len(MUST_MATCH) + len(MUST_REFUSE)
    print(f"\n{total - failures}/{total} passed, {failures} failed")
    if failures:
        print(
            "\nA failing 'must refuse' line means the app would give a confident\n"
            "wrong answer about government money. Narrow the keyword that caused\n"
            "it, or add the word to _STOPWORDS in schemes.py."
        )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
