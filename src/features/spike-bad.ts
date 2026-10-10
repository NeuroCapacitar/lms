import { Hono } from 'hono';
import { createApp } from '../server/app';

export const proibido = [new Hono(), createApp];
