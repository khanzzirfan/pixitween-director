import { expect, it } from 'vitest';
import { loadEnv } from '../env';
import { getLimits } from './limits-config';

it('maps the validated env to the limits, with the documented defaults', () => {
  expect(getLimits(loadEnv({}))).toEqual({
    filmsPerHourPerIp: 3, generateMaxPerHour: 4, maxUploadMb: 25, trustFlyClientIp: false,
    filmsInFlightMax: 2, filmsQueueMax: 4, filmsStartsPerWindow: 3, filmsWindowSec: 300,
  });
});

it('follows the env values', () => {
  const l = getLimits(loadEnv({ FILMS_PER_HOUR_PER_IP: '9', MAX_UPLOAD_MB: '5', TRUST_FLY_CLIENT_IP: 'true', FILMS_QUEUE_MAX: '1', FILMS_WINDOW_SEC: '60' }));
  expect(l).toMatchObject({ filmsPerHourPerIp: 9, maxUploadMb: 5, trustFlyClientIp: true, filmsQueueMax: 1, filmsWindowSec: 60 });
});
