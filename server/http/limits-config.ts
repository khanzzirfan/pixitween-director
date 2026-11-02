// Owned by S8b. Every limiter reads its numbers from here, which reads the validated env.
import { loadEnv, type Env } from '../env';

export interface Limits {
  filmsPerHourPerIp: number;
  generateMaxPerHour: number;
  maxUploadMb: number;
  trustFlyClientIp: boolean;
  filmsInFlightMax: number;
  filmsQueueMax: number;
  filmsStartsPerWindow: number;
  filmsWindowSec: number;
}

type LimitEnv = Pick<
  Env,
  'FILMS_PER_HOUR_PER_IP' | 'GENERATE_MAX_PER_HOUR' | 'MAX_UPLOAD_MB' | 'TRUST_FLY_CLIENT_IP' | 'FILMS_IN_FLIGHT_MAX' | 'FILMS_QUEUE_MAX' | 'FILMS_STARTS_PER_WINDOW' | 'FILMS_WINDOW_SEC'
>;

export function getLimits(env: LimitEnv = loadEnv()): Limits {
  return {
    filmsPerHourPerIp: env.FILMS_PER_HOUR_PER_IP,
    generateMaxPerHour: env.GENERATE_MAX_PER_HOUR,
    maxUploadMb: env.MAX_UPLOAD_MB,
    trustFlyClientIp: env.TRUST_FLY_CLIENT_IP,
    filmsInFlightMax: env.FILMS_IN_FLIGHT_MAX,
    filmsQueueMax: env.FILMS_QUEUE_MAX,
    filmsStartsPerWindow: env.FILMS_STARTS_PER_WINDOW,
    filmsWindowSec: env.FILMS_WINDOW_SEC,
  };
}
