import { notFound } from 'next/navigation';
import { BragFilm } from './BragFilm';

// The /brag launch video (brag-output/). Rendered frame by frame by headless Chrome; only exists under `next dev`.
export default function BragFilmPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <BragFilm />;
}
