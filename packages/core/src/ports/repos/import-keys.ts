export interface ImportKey {
  entity: string;
  entityId: string;
}

export interface ImportKeysRepo {
  get(key: string): ImportKey | null;
  set(key: string, entity: string, entityId: string): void;
}
