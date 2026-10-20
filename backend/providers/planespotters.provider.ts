import axios from 'axios';
import { z } from 'zod';
import { logger } from '../config/logger.ts';

// Fuente: https://www.planespotters.net/photo/api (gratis, sin llave; fotos revisadas por moderadores)
// Condiciones: User-Agent con contacto, mostrar el fotógrafo y enlazar a la foto; no se descarga la imagen
const http = axios.create({
  baseURL: 'https://api.planespotters.net/pub/photos',
  timeout: 5_000,
  headers: { 'User-Agent': 'DeliveryTracking/0.1 (+https://github.com/SamuEl0502/DeliveryTraking_Backend)' },
});

const photosSchema = z.object({
  photos: z.array(
    z.object({
      thumbnail: z.object({ src: z.string() }),
      thumbnail_large: z.object({ src: z.string() }),
      link: z.string(),
      photographer: z.string(),
    }),
  ),
});

export interface AircraftPhoto {
  photoUrl: string;
  photoThumbnailUrl: string;
  photoLink: string;
  photographer: string;
}

/** Primera foto del avión, o null si no hay o Planespotters falla (la foto es opcional) */
export async function fetchPhoto(icao24: string): Promise<AircraftPhoto | null> {
  try {
    const { data } = await http.get(`/hex/${encodeURIComponent(icao24)}`);
    const photo = photosSchema.parse(data).photos[0];
    if (!photo) return null;
    return {
      photoUrl: photo.thumbnail_large.src,
      photoThumbnailUrl: photo.thumbnail.src,
      photoLink: photo.link,
      photographer: photo.photographer,
    };
  } catch (err) {
    logger.warn({ icao24, status: axios.isAxiosError(err) ? err.response?.status : undefined }, 'planespotters failed');
    return null;
  }
}
