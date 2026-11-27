import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SEUIL_FROID, SEUIL_HUMIDITE, SEUIL_TEMPERATURE } from './config';
import { GraphiqueTemperature, useHistorique } from './GraphiqueTemperature';
import { PieceIsometrique } from './PieceIsometrique';
import type { Piece } from './types';

const COULEURS = {
  fond: '#F2F5F4',
  carte: '#FFFFFF',
  texte: '#17211F',
  texteDiscret: '#5A6865',
  accent: '#0B6E5F',
  alerte: '#B3261E',
  alerteFond: '#FBE9E7',
  froid: '#1565C0',
  froidFond: '#E3F0FC',
  desactive: '#C9D1CF',
  bordure: '#DDE3E1',
};

type MesureProps = {
  libelle: string;
  valeur: number | null; // null tant qu'aucune mesure n'est reçue
  unite: string;
  seuil: number;
  messageAlerte: string;
  seuilBas?: number; // en dessous : affichage « froid », en bleu
  messageBas?: string;
};

function CarteMesure({ libelle, valeur, unite, seuil, messageAlerte, seuilBas, messageBas }: MesureProps) {
  const haut = valeur !== null && valeur >= seuil;
  const bas = valeur !== null && seuilBas !== undefined && valeur < seuilBas;
  const ton = haut ? styles.texteAlerte : bas ? styles.texteFroid : null;
  return (
    <View style={[styles.carte, styles.carteMesure, haut && styles.carteAlerte, bas && styles.carteFroid]}>
      <Text style={styles.libelle}>{libelle}</Text>
      <Text style={[styles.valeur, ton]}>
        {valeur === null ? '—' : valeur.toFixed(1)}
        <Text style={styles.unite}> {unite}</Text>
      </Text>
      <Text style={[styles.detail, ton]}>
        {haut
          ? messageAlerte
          : bas
            ? messageBas
            : seuilBas === undefined
              ? `Seuil : ${seuil} ${unite}`
              : `Confort : ${seuilBas}–${seuil} ${unite}`}
      </Text>
    </View>
  );
}

type CommandeProps = {
  nom: string;
  etat: string;
  action: string;
  desactive: boolean;
  onPress: () => void;
};

function LigneCommande({ nom, etat, action, desactive, onPress }: CommandeProps) {
  return (
    <View style={styles.ligne}>
      <View>
        <Text style={styles.nom}>{nom}</Text>
        <Text style={styles.detail}>{etat}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${action} : ${nom}`}
        accessibilityState={{ disabled: desactive }}
        disabled={desactive}
        onPress={onPress}
        style={({ pressed }) => [
          styles.bouton,
          desactive && styles.boutonDesactive,
          pressed && styles.boutonPresse,
        ]}
      >
        <Text style={[styles.boutonTexte, desactive && styles.boutonTexteDesactive]}>{action}</Text>
      </Pressable>
    </View>
  );
}

export function HomeScreen({ piece }: { piece: Piece }) {
  const { mesures, recuA, etat } = piece;
  const historique = useHistorique(mesures, recuA, etat);
  const auto = etat?.mode === 'auto';
  const fenetreOuverte = etat?.fenetre === 'ouverte';
  const vmcAllumee = etat?.vmc === 'allumee';
  const chauffageAllume = etat?.chauffage === 'allume';
  // Pas de commande tant qu'on ne connaît pas l'état réel de l'objet, ni s'il ne peut pas la recevoir.
  const injoignable = etat === null || piece.broker !== 'connecte' || piece.objet === 'hors_ligne';
  const commandesBloquees = auto || injoignable;
  const prefixe =
    piece.source === 'demo'
      ? 'Données factices · '
      : piece.broker === 'reconnexion'
        ? `${piece.source === 'api' ? 'API' : 'Broker'} injoignable · `
        : piece.objet === 'hors_ligne'
          ? 'Objet hors ligne · '
          : '';
  const sousTitre =
    prefixe +
    (recuA ? `dernière mesure à ${recuA.toLocaleTimeString('fr-FR')}` : 'En attente de la première mesure');

  return (
    <SafeAreaView style={styles.ecran}>
      <ScrollView contentContainerStyle={styles.contenu}>
        <Text style={styles.titre}>Confort de la pièce</Text>
        <Text style={styles.detail}>{sousTitre}</Text>

        <View style={[styles.carte, styles.carteVue]}>
          <PieceIsometrique mesures={mesures} etat={etat} />
        </View>

        <View style={styles.mesures}>
          <CarteMesure
            libelle="Température"
            valeur={mesures?.temperature ?? null}
            unite="°C"
            seuil={SEUIL_TEMPERATURE}
            messageAlerte="Trop chaud"
            seuilBas={SEUIL_FROID}
            messageBas="Trop froid"
          />
          <CarteMesure
            libelle="Humidité"
            valeur={mesures?.humidite ?? null}
            unite="%"
            seuil={SEUIL_HUMIDITE}
            messageAlerte="Trop humide"
          />
        </View>

        <View style={styles.carte}>
          <Text style={[styles.nom, styles.titreCarte]}>Température et équipements</Text>
          <GraphiqueTemperature points={historique} />
        </View>

        <View style={styles.carte}>
          <View style={styles.ligne}>
            <View style={styles.texteMode}>
              <Text style={styles.nom}>Mode auto</Text>
              <Text style={styles.detail}>
                {etat === null
                  ? "État de l'objet inconnu"
                  : auto
                    ? "L'objet pilote fenêtre, VMC et chauffage"
                    : 'Vous pilotez fenêtre, VMC et chauffage'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Mode auto"
              value={auto}
              disabled={injoignable}
              onValueChange={(actif) => piece.changerMode(actif ? 'auto' : 'manuel')}
              trackColor={{ true: COULEURS.accent, false: COULEURS.desactive }}
            />
          </View>
          <View style={styles.separateur} />
          <LigneCommande
            nom="Fenêtre"
            etat={etat ? (fenetreOuverte ? 'Ouverte' : 'Fermée') : 'Inconnu'}
            action={fenetreOuverte ? 'Fermer' : 'Ouvrir'}
            desactive={commandesBloquees}
            onPress={() => piece.commanderFenetre(fenetreOuverte ? 'fermer' : 'ouvrir')}
          />
          <View style={styles.separateur} />
          <LigneCommande
            nom="VMC"
            etat={etat ? (vmcAllumee ? 'Allumée' : 'Coupée') : 'Inconnu'}
            action={vmcAllumee ? 'Couper' : 'Allumer'}
            desactive={commandesBloquees}
            onPress={() => piece.commanderVmc(vmcAllumee ? 'couper' : 'allumer')}
          />
          <View style={styles.separateur} />
          <LigneCommande
            nom="Chauffage"
            etat={
              !etat
                ? 'Inconnu'
                : chauffageAllume
                  ? 'Allumé'
                  : fenetreOuverte
                    ? 'Coupé : fenêtre ouverte'
                    : 'Éteint'
            }
            action={chauffageAllume ? 'Éteindre' : 'Allumer'}
            // On ne chauffe pas fenêtre ouverte (l'éteindre reste possible).
            desactive={commandesBloquees || (fenetreOuverte && !chauffageAllume)}
            onPress={() => piece.commanderChauffage(chauffageAllume ? 'eteindre' : 'allumer')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1, backgroundColor: COULEURS.fond },
  contenu: { padding: 16, gap: 16 },
  titre: { fontSize: 28, fontWeight: '700', color: COULEURS.texte },
  mesures: { flexDirection: 'row', gap: 12 },
  carte: {
    backgroundColor: COULEURS.carte,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COULEURS.bordure,
    padding: 16,
  },
  carteMesure: { flex: 1, gap: 4 },
  carteVue: { padding: 8 },
  carteAlerte: { backgroundColor: COULEURS.alerteFond, borderColor: COULEURS.alerte },
  libelle: { fontSize: 14, fontWeight: '600', color: COULEURS.texteDiscret },
  valeur: {
    fontSize: 36,
    fontWeight: '700',
    color: COULEURS.texte,
    fontVariant: ['tabular-nums'],
  },
  unite: { fontSize: 18, fontWeight: '500' },
  detail: { fontSize: 13, color: COULEURS.texteDiscret },
  texteAlerte: { color: COULEURS.alerte },
  carteFroid: { backgroundColor: COULEURS.froidFond, borderColor: COULEURS.froid },
  texteFroid: { color: COULEURS.froid },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
  },
  texteMode: { flex: 1 },
  titreCarte: { marginBottom: 8 },
  nom: { fontSize: 16, fontWeight: '600', color: COULEURS.texte },
  separateur: { height: 1, backgroundColor: COULEURS.bordure, marginVertical: 12 },
  bouton: {
    minWidth: 96,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: COULEURS.accent,
  },
  boutonPresse: { opacity: 0.8 },
  boutonDesactive: { backgroundColor: COULEURS.desactive },
  boutonTexte: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  boutonTexteDesactive: { color: COULEURS.texteDiscret },
});
