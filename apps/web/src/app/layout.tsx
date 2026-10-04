import type { ReactNode } from 'react';
import Link from 'next/link';
import { Layers3 } from 'lucide-react';
import { publicProductConfig } from '@contentos/config';
import './globals.css';
export function generateMetadata() { const product = publicProductConfig(process.env); return { title: product.name, description: 'Рабочее пространство вашей контент-команды' }; }
export default function RootLayout({ children }: { children: ReactNode }) {
  const product = publicProductConfig(process.env);
  return <html lang="ru"><body><header className="app-header"><Link className="wordmark" href="/"><span className="logo-mark"><Layers3 size={19} /></span>{product.name}</Link><span className="header-caption">CONTENT WORKSPACE</span><Link className="header-link" href="/dashboard">Моё пространство ↗</Link></header><main>{children}</main></body></html>;
}
