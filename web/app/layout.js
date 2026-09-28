import './globals.css';
import AppTopbar from '@/components/AppTopbar';

export const metadata = {
  title: 'Inthegra Reports',
  description: 'Portal dinamico de reportes operativos Inthegra',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body><AppTopbar />{children}</body>
    </html>
  );
}
