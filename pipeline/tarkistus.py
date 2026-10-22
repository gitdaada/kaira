#!/usr/bin/env python3
"""Rajapintojen tarkistus GitHub Actionsissa (käsin käynnistettävä): tulostaa vastausten rakenteen, jotta
sovelluksen jäsennys voidaan todeta oikeaksi oikealla datalla. Ei tallenna mitään."""
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vesitilanne as V  # noqa: E402

FMI = "https://opendata.fmi.fi/wfs"


def gh(level, msg):
    print("::%s::%s" % (level, str(msg).replace("\n", " ")[:950]), flush=True)


def fmi(q):
    url = FMI + "?" + urllib.parse.urlencode(dict({"service": "WFS", "version": "2.0.0", "request": "getFeature"}, **q))
    req = urllib.request.Request(url, headers={"User-Agent": V.UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def members(xml):
    return re.findall(r"<wfs:member>.*?</wfs:member>", xml, re.S)


def iso(t):
    return t.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    now = dt.datetime.now(dt.timezone.utc)
    # Salamat: rakenne ensimmäisestä havainnosta (haetaan taaksepäin, kunnes löytyy)
    for days in (1, 7, 30):
        try:
            x = fmi({"storedquery_id": "fmi::observations::lightning::simple", "bbox": "19,59,32,71", "parameters": "peak_current,multiplicity",
                     "starttime": iso(now - dt.timedelta(days=days)), "endtime": iso(now)})
        except Exception as e:  # noqa: BLE001
            gh("warning", "Salamat %d vrk: %r" % (days, e))
            continue
        m = members(x)
        gh("notice", "Salamat %d vrk: %d jäsentä, %d tavua" % (days, len(m), len(x)))
        if m:
            gh("notice", "Salamat esimerkki: " + re.sub(r"\s+", " ", m[0])[:900])
            break
    # Lumensyvyys
    try:
        x = fmi({"storedquery_id": "fmi::observations::weather::simple", "bbox": "24,66,30,70", "parameters": "snow_aws",
                 "starttime": iso(now - dt.timedelta(hours=3)), "endtime": iso(now), "timestep": "60"})
        m = members(x)
        pos = {re.search(r"<gml:pos>([^<]+)</gml:pos>", s).group(1).strip() for s in m if "<gml:pos>" in s}
        vals = re.findall(r"<BsWfs:ParameterValue>([^<]*)</BsWfs:ParameterValue>", x)
        gh("notice", "Lumi: %d jäsentä, %d asemaa, arvoja esim. %s" % (len(m), len(pos), vals[:12]))
        if m:
            gh("notice", "Lumi esimerkki: " + re.sub(r"\s+", " ", m[0])[:900])
        else:
            gh("notice", "Lumi vastaus: " + re.sub(r"\s+", " ", x)[:900])
    except Exception as e:  # noqa: BLE001
        gh("warning", "Lumi: %r" % e)
    # Syke: pintaveden lämpötila
    try:
        V.syke_suureet()
        temp = {k: v for k, v in V.SUURE.items() if "lämpö" in (v[0] or "").lower() or "lampo" in (v[0] or "").lower()}
        gh("notice", "Syke lämpösuureet: %s" % temp)
        rows = V.syke_json("LampoPintavesi", {"$top": "3", "$orderby": "Aika desc"})
        gh("notice", "Syke LampoPintavesi esimerkki: %s" % json.dumps(rows[:3], ensure_ascii=False)[:800])
        sid = next(iter(temp)) if temp else None
        if sid is not None:
            ps = V.syke_json("Paikka", {"$filter": "Suure_Id eq %d" % sid, "$top": "3"})
            gh("notice", "Syke lämpöasemat (Suure %s): %d, esim. %s" % (sid, len(ps), json.dumps(ps[:2], ensure_ascii=False)[:600]))
    except Exception as e:  # noqa: BLE001
        gh("warning", "Syke: %r" % e)
    # Vesistökäyrät oikealla datalla: keinotekoinen uoma Roukkajankosken (Nurmes) asemien kohdalla
    try:
        lat, lon = V.dms("633838"), V.dms("290549")
        gj = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"joki_id": "testi"},
              "geometry": {"type": "LineString", "coordinates": [[lon - 0.02, lat - 0.005], [lon, lat], [lon + 0.02, lat + 0.005]]}}]}
        today = now.date()
        stations = V.syke_stations({"bbox_latlon": V.river_bbox(gj, 0.05)})
        m, ms = V.syke_status({"id": "testi"}, gj, stations, today)
        for x in ms:
            gh("notice", "Käyrä %s: asema %s, arvo %s %s, sarja %d pv, kaista %d pv, luokka %s" % (
                x["suure"], x["asema"], x["arvo"], x["yksikko"], len(x["sarja"]), len(x["kaista"]), x["luokka"]))
        t = V.temperature({"id": "testi"}, gj, V.syke_temp_stations(V.river_bbox(gj, 0.15)), today)
        gh("notice", "Lämpötila: %s" % (json.dumps({k: t[k] for k in ("asema", "arvo", "aika", "etaisyys_km", "vuodet")}, ensure_ascii=False)
                                         + " sarja %d, kaista %d" % (len(t["sarja"]), len(t["kaista"])) if t else "ei asemaa"))
        for line in V.log[-12:]:
            gh("notice", "Loki: " + line)
    except Exception as e:  # noqa: BLE001
        gh("warning", "Vesistökäyrät: %r" % e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
