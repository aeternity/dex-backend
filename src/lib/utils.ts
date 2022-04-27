export const nonNullable = <T>(t: T | null | undefined): T => {
  if (t == null) {
    throw new Error('non nullable value expected');
  }
  return t;
};

export const removeId = <ID, T extends { id: ID }>(t: T) => {
  const {
    id, // eslint-disable-line @typescript-eslint/no-unused-vars
    ...tail
  } = t;
  return tail;
};

export const pluralize = (count: number, noun: string, suffix = 's') =>
  `${count} ${noun}${count !== 1 ? suffix : ''}`;

export const NETWORK_NAME = process.env.NETWORK_NAME || 'testnet';

export type ContractAddress = `ct_${string}`;
export type WalletAddress = `ak_${string}`;
export type CallData = `cb_${string}`; //TODO: are all starting with cb?
export type Signature = `sg_${string}`;
export type Hash = `th_${string}`;
export type BlockHash = `mh_${string}`;
