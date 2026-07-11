import './globals.css';

export const metadata = {
  title: 'Real-Time Collaborative Notes',
  description: 'A workspace built for real-time collaboration.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <main className="min-h-screen bg-background text-foreground antialiased">{children}</main>
      </body>
    </html>
  );
}
