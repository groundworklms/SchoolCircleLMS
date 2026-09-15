import "./globals.css";

export const metadata = {
  title: "SchoolCircle",
  description: "Grounded, offline, human-led LMS. Every answer cites the manual or refuses.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
