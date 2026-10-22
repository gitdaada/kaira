"""Marja- ja sienimallin testit synteettisellä datalla: python3 tests/test_marjat.py"""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
import marjat  # noqa: E402


def stand(h, age, pine, spruce, birch, cc, site, soil, n=12):
    f = lambda v: np.full((n, n), v, dtype=np.float32)  # noqa: E731
    return {"height": f(h), "age": f(age), "pine": f(pine), "spruce": f(spruce), "birch": f(birch), "otherbl": f(0),
            "volume": f(pine + spruce + birch), "canopy": f(cc), "canopyBl": f(5),
            "site": np.full((n, n), site, dtype=np.int32), "soil": np.full((n, n), soil, dtype=np.int32)}


def score(L, cut=None):
    out = marjat.berry_scores(L, np.ones(L["height"].shape, dtype=bool), cut)
    return {k: int(v[6, 6]) for k, v in out.items()}


old_mt_pine = score(stand(20, 110, 140, 40, 10, 60, 3, 1))     # vanha tuore mäntykangas
dry_pine = score(stand(12, 45, 90, 5, 5, 40, 4, 1))            # keski-ikäinen kuivahko mäntykangas
old_spruce = score(stand(24, 90, 20, 200, 20, 75, 3, 1))       # varttunut tuore kuusikangas
mid_mixed = score(stand(16, 55, 60, 60, 25, 50, 3, 1))         # keski-ikäinen tuore sekametsä
bog = score(stand(0.5, 0, 0, 0, 0, 0, 4, 4))                   # avosuo
seedling = score(stand(1.5, 6, 3, 1, 1, 10, 3, 1))             # taimikko

assert old_mt_pine["mustikka"] >= 191, old_mt_pine                       # tuore kangas, vanha, mänty: hyvä
assert old_mt_pine["mustikka"] > old_spruce["mustikka"], (old_mt_pine, old_spruce)  # kuusi vähentää
assert dry_pine["puolukka"] >= 191 and dry_pine["puolukka"] > old_spruce["puolukka"], (dry_pine, old_spruce)
assert dry_pine["mustikka"] < old_mt_pine["mustikka"]                    # kuivahko 63 % tuoreesta
assert old_spruce["suppilovahvero"] >= 191 and dry_pine["suppilovahvero"] < 128, (old_spruce, dry_pine)
assert old_mt_pine["kantarelli"] >= 128 and seedling["kantarelli"] == 0, (old_mt_pine, seedling)
assert mid_mixed["herkkutatti"] >= 191 and seedling["herkkutatti"] == 0, (mid_mixed, seedling)
assert max(bog.values()) <= 20, bog                                      # avosuolla ei mitään merkittävää
assert max(seedling.values()) < 128, seedling
L = stand(20, 110, 140, 40, 10, 60, 3, 1)
cut = np.zeros((12, 12), dtype=bool); cut[4:9, 4:9] = True
assert max(score(L, cut).values()) == 0                                  # uusi hakkuu: ei marja- eikä sienimetsää
print("marja- ja sienimalli läpi")
