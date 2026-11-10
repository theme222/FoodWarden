import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";

export async function findGatewayFridge(
  firestore: Firestore,
  transaction: Transaction,
  tokenHash: string,
): Promise<DocumentReference | null> {
  const matches = await transaction.get(
    firestore.collectionGroup("private").where("gatewayTokenHash", "==", tokenHash),
  );
  const configs = matches.docs.filter((doc) =>
    /^fridges\/[^/]+\/private\/config$/.test(doc.ref.path),
  );
  return configs.length === 1 ? configs[0]?.ref.parent.parent ?? null : null;
}
