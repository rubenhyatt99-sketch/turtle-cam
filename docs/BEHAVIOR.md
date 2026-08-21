# Analyse comportementale (v2)

## Ce que l'agent observe réellement

Il n'y a pas de reconnaissance d'objet : dans un terrarium, la tortue est le
seul élément mobile de la scène. L'agent suit donc **le barycentre du
mouvement** entre deux images et regarde dans quelle zone il tombe.

```
image N-1 ──┐
            ├─▶ différence ─▶ seuillage ─▶ barycentre ─▶ zone ─▶ machine à états
image N   ──┘                    ▲
                                 └── la moyenne des écarts est retirée d'abord,
                                     pour ignorer les changements de luminosité
                                     (nuage, lampe chauffante, passage en IR)
```

Cette approche a des limites assumées : deux animaux dans l'enclos, une main
qui entre dans le champ ou un fond très texturé la mettent en défaut. En
contrepartie elle tourne sur un Raspberry Pi sans accélérateur, en continu,
sans envoyer une seule image à un service tiers.

## De la zone à l'événement

Une transition n'est retenue que si la nouvelle zone est tenue pendant
`zoneDebounceSec` (4 s par défaut). Cela élimine les oscillations du barycentre
quand la tortue est à cheval sur deux zones.

| Événement | Condition | Réglage |
| --- | --- | --- |
| `sortie_maison` | quitte `maison` et reste dehors | `minOutingSec` (45 s) |
| `retour_maison` | revient dans `maison` et y reste | `minReturnSec` (120 s) |
| `repas` | reste dans `gamelle` | `mealMinSec` (60 s), garde `mealCooldownSec` (30 min) |
| `bain` | reste dans `bassin` | `bathMinSec` (90 s) |
| `bronzage` | reste dans `lampe` | `baskMinSec` (5 min) |
| `reveil` | premier mouvement de la journée | — |

Les durées sont provisoires à l'émission puis **figées à la sortie de la zone** :
un repas apparaît dans le portail dès qu'il est détecté, et sa durée se précise
quand la tortue s'éloigne de la gamelle.

La garde (`mealCooldownSec`) évite qu'un aller-retour gamelle → lampe → gamelle
soit compté comme deux repas.

## Le résumé quotidien

Toutes les minutes, l'agent écrit `meta/daily-AAAA-MM-JJ.json` dans Drive :

```json
{
  "day": "2026-07-01",
  "firstMotionAt": "2026-07-01T05:42:10.000Z",
  "wakeUpAt": "2026-07-01T06:14:02.000Z",
  "bedTimeAt": "2026-07-01T18:51:30.000Z",
  "meals": 2,
  "mealTimes": ["2026-07-01T07:20:11.000Z", "2026-07-01T15:02:44.000Z"],
  "zoneSeconds": { "maison": 31200, "lampe": 9100, "gamelle": 620, "bassin": 1450 },
  "activeSeconds": 4820,
  "clips": 37,
  "events": [ … ]
}
```

À minuit (fuseau local), la journée est close et une nouvelle démarre. Les clips
sont purgés au bout de 7 jours, **mais ces résumés sont conservés un an** : ils
ne pèsent que quelques kilo-octets et constituent l'historique à partir duquel
les habitudes sont calculées.

## Habitudes et anomalies

La page *Comportement* du portail compare la journée en cours aux journées
précédentes :

* **heure de sortie / de retour habituelles** — moyenne sur les jours précédents ;
* **rythme des repas** — les horaires sont regroupés par créneaux de 3 h, ce qui
  fait apparaître un rythme (« vers 08:10 » et « vers 16:40 ») plutôt qu'une
  moyenne unique sans signification ;
* **activité quotidienne** — secondes de mouvement cumulées.

Une alerte n'est levée que sur un écart net, et jamais avant que la journée soit
assez avancée pour être comparable :

| Alerte | Déclenchement |
| --- | --- |
| Aucun mouvement aujourd'hui | après 11 h, zéro clip |
| Toujours dans la maison | 2 h après l'heure de sortie habituelle |
| Sortie tardive / matinale | écart de plus de 90 min à la moyenne |
| Aucun repas détecté | 2 h après le dernier créneau de repas habituel |
| Activité effondrée | moins de 40 % de l'activité attendue au prorata de la journée écoulée |

Ces seuils sont volontairement larges : une alerte qui se déclenche tous les
jours ne sert à rien. Ils vivent dans `lib/insights.ts`, fonction
`detectAnomalies`, et se règlent sans toucher à l'agent.

## Pistes pour la suite

* Ajouter la température de l'eau / de la lampe via une sonde et la corréler à
  l'activité — la léthargie d'une tortue suit d'abord la température.
* Remplacer le barycentre par un détecteur léger (YOLO-nano, MobileSSD) sur le
  Raspberry Pi 5 : cela lèverait la limite « un seul objet mobile ».
* Notification push (ntfy, Telegram) sur les alertes plutôt qu'un affichage
  passif dans le portail.
