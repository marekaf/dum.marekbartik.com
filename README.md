# dum.marekbartik.com

A static page in Czech. A visitor enters a house number with its municipality, or a parcel number with its cadastral area. The page shows the aerial photo of that place from the 1950s next to today's photo, with the parcel and building outline on both.

The site is https://dum.marekbartik.com, served by GitHub Pages from the `main` branch.

## How it works

The browser calls four public map services. The site has no server part, stores nothing and has no analytics.

| What | Service | Terms |
| - | - | - |
| 1950s photo | CENIA WMTS `gis.cenia.cz/mapcache/ortofotomapa_historicka/wmts`, tile matrix set `jtsk:epsg:5514` | CC BY 4.0, [metadata](https://micka.cenia.cz/record/basic/60b09c14-9538-4a0f-a66c-6118c0a80164) |
| Year of the 1950s photo | CENIA WMS `gis.cenia.cz/geoserver/ortofotomapa_historicka_roky/wms`, GetFeatureInfo, field `rok` | CC BY 4.0, [metadata](https://micka.cenia.cz/record/basic/62208754-7a50-452b-8f4b-729ac0a80164) |
| Today's photo | ČÚZK WMS `ags.cuzk.gov.cz/arcgis1/services/ORTOFOTO/MapServer/WMSServer`, layer `0` | [ČÚZK network service terms](https://www.cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-sitovych-sluzeb-CUZK.aspx), [metadata](https://geoportal.gov.cz/php/micka/record/basic/CZ-CUZK-WMS-ORTOFOTO-P) |
| Search, parcels, buildings, addresses | ČÚZK RÚIAN ArcGIS service `ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Vyhledavaci_sluzba_nad_daty_RUIAN/MapServer`, `query` and the `GeocodeSOE` suggest | same ČÚZK terms, [metadata](https://geoportal.gov.cz/php/micka/record/basic/CZ-CUZK-AGS-RUIAN) |

Everything is in S-JTSK (EPSG:5514), so the page needs no map library and no coordinate transform. `lib.js` holds the tile grid math and the input parsing. `app.js` holds the search and the map.

The credit lines in the page footer and in the map corner are required by the terms above. Keep them when the page changes.

The page asks the services only for what one visitor looks at: the name suggestions after a pause in typing, one lookup, the tiles of the visible map and one today's image per map move.

## Run it

Serve the folder with any static file server and open `index.html`. ES modules do not load from `file://`.

## Tests

```sh
node --test
```
