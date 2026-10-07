// argon2id for follow-up secrets (SPEC §7). Default @node-rs/argon2 parameters are argon2id.
import { hash, verify } from '@node-rs/argon2';
import type { SecretHasher } from './api/deps';

export const argon2Hasher: SecretHasher = {
  hash: (secret) => hash(secret),
  verify: async (h, secret) => {
    try {
      return await verify(h, secret);
    } catch {
      return false;
    }
  },
};
