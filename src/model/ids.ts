import { nanoid } from 'nanoid';

export const newMapId = (): string => nanoid(21);
export const newNodeId = (): string => nanoid(10);
