import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Identifiants } from './types';

const CLE = 'identifiants-broker';

// Sur téléphone : trousseau iOS ou Keystore Android, via expo-secure-store.
// Sur le web (tests sur PC uniquement), SecureStore n'existe pas : rien n'est gardé après rechargement.
const surWeb = Platform.OS === 'web';
let memoireWeb: string | null = null;

export async function lireIdentifiants(): Promise<Identifiants | null> {
  const texte = surWeb ? memoireWeb : await SecureStore.getItemAsync(CLE);
  if (!texte) return null;
  try {
    const valeur = JSON.parse(texte);
    if (typeof valeur?.utilisateur === 'string' && typeof valeur?.motDePasse === 'string') return valeur;
  } catch {
    // contenu illisible : on redemandera les identifiants
  }
  return null;
}

export async function enregistrerIdentifiants(identifiants: Identifiants): Promise<void> {
  const texte = JSON.stringify(identifiants);
  if (surWeb) memoireWeb = texte;
  else await SecureStore.setItemAsync(CLE, texte);
}

export async function effacerIdentifiants(): Promise<void> {
  if (surWeb) memoireWeb = null;
  else await SecureStore.deleteItemAsync(CLE);
}
