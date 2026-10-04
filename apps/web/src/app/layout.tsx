import type { ReactNode } from 'react';
import { publicProductConfig } from '@contentos/config';
export const metadata = { title: 'Content operations', description: 'AI content workspace' };
export default function RootLayout({ children }: { children: ReactNode }) {
  const product = publicProductConfig(process.env);
  return <html lang="ru"><body><header>{product.name}</header><main>{children}</main></body></html>;
}
