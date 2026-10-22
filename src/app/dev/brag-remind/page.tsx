import { notFound } from 'next/navigation';
import { RemindFilm } from '../brag/RemindFilm';

// The Remind launch video (brag-output/remind.mp4). Rendered frame by frame by headless Chrome; only exists under `next dev`.
export default function RemindFilmPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <RemindFilm />;
}
