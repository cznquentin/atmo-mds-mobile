// Vérifie la logique de la pièce : node test/logique.test.mjs (Node ≥ 22.18, types TS effacés nativement).
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Les imports de l'app n'ont pas d'extension (style Metro) : on ajoute « .ts » pour Node.
registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.')) return next(spec + '.ts', ctx);
      throw e;
    }
  },
});
const { decisionAuto, evoluer, securiser } = await import('../src/logique.ts');

const base = { fenetre: 'fermee', vmc: 'coupee', chauffage: 'eteint', mode: 'auto' };

// Froid : on chauffe ; chaud : on ouvre et on coupe le chauffage ; humide : VMC.
assert.equal(decisionAuto({ temperature: 17, humidite: 50 }, base).chauffage, 'allume');
const chaud = decisionAuto({ temperature: 29, humidite: 50 }, { ...base, chauffage: 'allume' });
assert.deepEqual([chaud.fenetre, chaud.chauffage], ['ouverte', 'eteint']);
assert.equal(decisionAuto({ temperature: 22, humidite: 72 }, base).vmc, 'allumee');

// Hystérésis : entre les deux seuils, l'état ne bouge pas.
assert.equal(decisionAuto({ temperature: 20, humidite: 50 }, { ...base, chauffage: 'allume' }).chauffage, 'allume');
assert.equal(decisionAuto({ temperature: 27, humidite: 50 }, { ...base, fenetre: 'ouverte' }).fenetre, 'ouverte');
assert.equal(decisionAuto({ temperature: 22, humidite: 65 }, { ...base, vmc: 'allumee' }).vmc, 'allumee');
assert.equal(decisionAuto({ temperature: 22, humidite: 59 }, { ...base, vmc: 'allumee' }).vmc, 'coupee');

// Sécurité : jamais de chauffage fenêtre ouverte.
assert.equal(securiser({ ...base, fenetre: 'ouverte', chauffage: 'allume' }).chauffage, 'eteint');

// Physique : le chauffage réchauffe, la fenêtre refroidit, la VMC assèche.
const m = { temperature: 20, humidite: 65 };
assert.ok(evoluer(m, { ...base, chauffage: 'allume' }).temperature > m.temperature);
assert.ok(evoluer(m, { ...base, fenetre: 'ouverte' }).temperature < m.temperature);
assert.ok(evoluer(m, { ...base, vmc: 'allumee' }).humidite < m.humidite);

// En auto, partant du froid, la pièce se stabilise dans la zone de confort.
let mesures = { temperature: 15, humidite: 55 };
let etat = base;
for (let i = 0; i < 300; i++) {
  mesures = evoluer(mesures, etat);
  etat = decisionAuto(mesures, etat);
}
assert.ok(mesures.temperature >= 18 && mesures.temperature <= 22, `température ${mesures.temperature}`);
assert.ok(mesures.humidite < 72, `humidité ${mesures.humidite}`);

console.log('logique : OK');
