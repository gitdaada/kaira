"""
Marjojen ja sienten kasvupaikka-arvio MVMI-aineistosta (16 m ruudut), Kairan eränkäyntiosiota varten.

Arvio kertoo, missä laji todennäköisesti kasvaa runsaasti. Se ei ole satoennuste: vuotuinen sato vaihtelee
säiden mukaan paljon. Pisteet 0-1 lajeittain, tallennus 0-255 (0,5 = sopiva, 0,75 = hyvä).

  Mustikka: Luonnonvarakeskuksen malliin (Turtiainen, Miina, Salo & Hotanen 2016, Silva Fennica 50(4) 1573)
            perustuva yksinkertaistus. Peittävyys on suurin tuoreilla kankailla (kuivahkot 63 %, lehtomaiset 57 %
            siitä), kasvaa metsän iän mukana (noin 175 vuoteen) ja puuston tiheyden mukana (pohjapinta-ala
            noin 26 m²/ha, tässä tilavuus sijaismuuttujana), on pienempi kuusi- kuin mäntyvaltaisissa ja
            lehtipuuvaltaisissa rehevissä metsissä sekä soilla keskimäärin pienempi kuin kankailla.
  Puolukka: asiantuntija-arvio: kuivahkot ja kuivat mäntykankaat, kohtalaisen harva puusto, nuoret ja
            keski-ikäiset metsät; puolukkaturvekankaat ja rämeet vähäisemmin.
  Kantarelli: asiantuntija-arvio: tuoreet ja kuivahkot kankaat, varttuneet sekametsät (mänty, kuusi, koivu).
  Suppilovahvero: asiantuntija-arvio: varttuneet kuusivaltaiset tuoreet ja lehtomaiset kankaat sekä korvet.
  Herkkutatti (myös männynherkkutatti): asiantuntija-arvio: tuoreet ja kuivahkot kankaat, nuoret ja
            keski-ikäiset havu- ja sekametsät, koivu lisänä.

Metsätiedon jälkeen hakatut kohdat (latvusmalli) eivät ole marja- eivätkä sienimetsää.
"""
from __future__ import annotations

import numpy as np

from habitat import box_mean, lookup, ramp

LAJIT = ("mustikka", "puolukka", "kantarelli", "suppilovahvero", "herkkutatti")

# MVMI:n kasvupaikkaluokka: 1 lehto, 2 lehtomainen kangas, 3 tuore kangas, 4 kuivahko kangas, 5 kuiva kangas,
# 6 karukkokangas, 7 kalliomaa tai hietikko, 8 lakimetsä tai tunturi. Päätyyppi: 1 kangas, 2 korpi, 3 räme, 4 neva.
SITE = {
    "mustikka": {1: 0.3, 2: 0.57, 3: 1.0, 4: 0.63, 5: 0.3, 6: 0.15, 7: 0.05, 8: 0.8},
    "puolukka": {1: 0.05, 2: 0.15, 3: 0.5, 4: 1.0, 5: 0.85, 6: 0.45, 7: 0.35, 8: 0.5},
    "kantarelli": {1: 0.3, 2: 0.6, 3: 1.0, 4: 0.9, 5: 0.5, 6: 0.2, 7: 0.1, 8: 0.2},
    "suppilovahvero": {1: 0.6, 2: 0.9, 3: 1.0, 4: 0.5, 5: 0.2, 6: 0.1, 7: 0.0, 8: 0.1},
    "herkkutatti": {1: 0.4, 2: 0.7, 3: 1.0, 4: 0.9, 5: 0.5, 6: 0.2, 7: 0.1, 8: 0.2},
}
SOIL = {
    "mustikka": {1: 1.0, 2: 0.75, 3: 0.55, 4: 0.05},
    "puolukka": {1: 1.0, 2: 0.25, 3: 0.55, 4: 0.05},
    "kantarelli": {1: 1.0, 2: 0.3, 3: 0.15, 4: 0.0},
    "suppilovahvero": {1: 1.0, 2: 0.85, 3: 0.25, 4: 0.0},
    "herkkutatti": {1: 1.0, 2: 0.2, 3: 0.1, 4: 0.0},
}


def berry_scores(L: dict, valid: np.ndarray, new_cut: np.ndarray | None) -> dict:
    """L kuten habitat.habitat_scores. Palauttaa {laji: uint8 0-255}."""
    f = {k: np.nan_to_num(np.asarray(v, dtype=np.float32), nan=0.0) for k, v in L.items()}
    H, A, V = f["height"], f["age"], f["volume"]
    bl = f["birch"] + f["otherbl"]
    vol = np.maximum(V, f["pine"] + f["spruce"] + bl)
    has = vol >= 5
    with np.errstate(invalid="ignore", divide="ignore"):
        sp = np.where(has, f["pine"] / vol, 0)
        ss = np.where(has, f["spruce"] / vol, 0)
        sb = np.where(has, bl / vol, 0)
    CC = f["canopy"]
    site = np.asarray(L["site"]).astype(np.int32)
    soil = np.asarray(L["soil"]).astype(np.int32)
    cut = new_cut if new_cut is not None else np.zeros(H.shape, dtype=bool)
    rich = (site >= 1) & (site <= 2)

    def site_soil(k):
        return lookup(site, SITE[k], 0.0) * lookup(soil, SOIL[k], 0.3)

    out = {}
    # Mustikka: ikä ja tiheys kasvattavat, kuusi ja rehevien kankaiden lehtipuu vähentävät, taimikko heikko.
    mus = (site_soil("mustikka")
           * (0.2 + 0.8 * ramp(A, 15, 90))
           * (0.25 + 0.75 * ramp(vol, 20, 150)) * (1 - 0.35 * ramp(vol, 250, 400))
           * (1 - 0.35 * ss) * np.where(rich, 1 - 0.4 * sb, 1.0)
           * (0.3 + 0.7 * ramp(H, 2, 6)))
    out["mustikka"] = mus
    # Puolukka: valoisa, kuivahko tai kuiva mäntykangas, nuori tai keski-ikäinen metsä.
    out["puolukka"] = (site_soil("puolukka")
                       * ramp(CC, 5, 25) * (1 - 0.6 * ramp(CC, 55, 85))
                       * ramp(A, 8, 25) * (1 - 0.3 * ramp(A, 80, 140))
                       * (0.5 + 0.5 * ramp(sp, 0.4, 0.8)))
    # Kantarelli: varttunut havu- tai sekametsä tuoreella tai kuivahkolla kankaalla.
    out["kantarelli"] = (site_soil("kantarelli")
                         * ramp(A, 30, 60) * (1 - 0.3 * ramp(A, 140, 200))
                         * ramp(CC, 25, 50) * (1 - 0.35 * ramp(CC, 70, 90)) * ramp(vol, 30, 100)
                         * (0.7 + 0.3 * ramp(sp + sb, 0.3, 0.7)))  # puhdas tiheä kuusikko heikompi
    # Suppilovahvero: varttunut kuusivaltainen metsä, tuore tai lehtomainen kangas tai korpi.
    out["suppilovahvero"] = (site_soil("suppilovahvero")
                             * ramp(ss, 0.3, 0.7) * ramp(A, 40, 80) * ramp(CC, 40, 65))
    # Herkkutatti: nuori tai keski-ikäinen havu- tai sekametsä, koivu lisänä.
    out["herkkutatti"] = (site_soil("herkkutatti")
                          * ramp(A, 20, 40) * (1 - 0.3 * ramp(A, 100, 160))
                          * (0.8 + 0.2 * ramp(sb, 0.05, 0.25)) * ramp(CC, 25, 45) * ramp(H, 6, 10))

    res = {}
    for k in LAJIT:
        sc = np.where(valid, out[k], 0).astype(np.float32)
        sc[cut] = 0
        # Kevyt tasoitus: yksittäiset ruudut eivät ole kasvupaikkaa, laikut ovat.
        sc = np.where(valid, box_mean(sc, 1), 0)
        res[k] = np.clip(np.rint(sc * 255), 0, 255).astype(np.uint8)
    return res
