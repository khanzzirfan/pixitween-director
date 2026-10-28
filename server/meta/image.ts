import { Buffer } from 'node:buffer';
import type { MetaClients } from '@shared/ports';
import type { MetaHttp } from './http';
import { sniffImageMime } from './mime';

export class MuseImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MuseImageError';
  }
}

const MODEL = 'muse-image-1.0';
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function pick(body: { data?: Array<{ b64_json?: string }> }, status: number): Buffer {
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new MuseImageError(`response carried no image (HTTP ${status})`);
  return Buffer.from(b64, 'base64');
}

export function createImageClient(http: MetaHttp): MetaClients['image'] {
  return {
    async generate(prompt, size = '1536x1024') {
      const r = await http.json<{ data?: Array<{ b64_json?: string }> }>('/images/generations', {
        model: MODEL,
        prompt,
        size,
        n: 1,
        output_format: 'png',
        tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
      });
      return pick(r.body, r.status);
    },

    async edit(prompt, refs, size = '1536x1024') {
      if (refs.length === 0) throw new MuseImageError('edit needs at least one reference image');
      const form = new FormData();
      form.set('model', MODEL);
      form.set('output_format', 'png');
      form.set('prompt', prompt);
      form.set('size', size);
      refs.forEach((buf, i) => {
        const mime = sniffImageMime(buf);
        // One reference goes in `image`; several go in `image[0]`, `image[1]`, never `image[]`.
        form.append(refs.length === 1 ? 'image' : `image[${i}]`, new Blob([new Uint8Array(buf)], { type: mime }), `ref-${i}.${EXT[mime]}`);
      });
      const r = await http.form('/images/edits', form);
      return pick(JSON.parse(r.text) as { data?: Array<{ b64_json?: string }> }, r.status);
    },
  };
}
