import './globals.css';
import './_components/widgets.css';
import { AuthProvider } from './_auth/AuthProvider';
import AskWidget from './_components/AskWidget';
import QaWidget from './_components/QaWidget';

export const metadata = {
  title: 'SchoolCircle',
  description: 'Grounded, offline, human-led training — every answer cites the manual or refuses.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <AuthProvider>
          {children}
          <AskWidget />
          <QaWidget />
        </AuthProvider>
      </body>
    </html>
  );
}
