import './globals.css';

export const metadata = {
  title: 'Inthegra Reports',
  description: 'Portal dinamico de reportes operativos Inthegra',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
