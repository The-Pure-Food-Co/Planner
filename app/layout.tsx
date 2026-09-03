import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { AuthProvider } from '@/lib/auth'

const gilroy = localFont({
  variable: '--font-gilroy',
  display: 'swap',
  src: [
    { path: '../purefood_font/Gilroy-Thin.ttf', weight: '100', style: 'normal' },
    { path: '../purefood_font/Gilroy-ThinItalic.ttf', weight: '100', style: 'italic' },
    { path: '../purefood_font/Gilroy-UltraLight.ttf', weight: '200', style: 'normal' },
    { path: '../purefood_font/Gilroy-UltraLightItalic.ttf', weight: '200', style: 'italic' },
    { path: '../purefood_font/Gilroy-Light.ttf', weight: '300', style: 'normal' },
    { path: '../purefood_font/Gilroy-LightItalic.ttf', weight: '300', style: 'italic' },
    { path: '../purefood_font/Gilroy-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../purefood_font/Gilroy-RegularItalic.ttf', weight: '400', style: 'italic' },
    { path: '../purefood_font/Gilroy-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../purefood_font/Gilroy-MediumItalic.ttf', weight: '500', style: 'italic' },
    { path: '../purefood_font/Gilroy-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../purefood_font/Gilroy-SemiBoldItalic.ttf', weight: '600', style: 'italic' },
    { path: '../purefood_font/Gilroy-Bold.ttf', weight: '700', style: 'normal' },
    { path: '../purefood_font/Gilroy-BoldItalic.ttf', weight: '700', style: 'italic' },
    { path: '../purefood_font/Gilroy-ExtraBold.ttf', weight: '800', style: 'normal' },
    { path: '../purefood_font/Gilroy-ExtraBoldItalic.ttf', weight: '800', style: 'italic' },
    { path: '../purefood_font/Gilroy-Black.ttf', weight: '900', style: 'normal' },
    { path: '../purefood_font/Gilroy-BlackItalic.ttf', weight: '900', style: 'italic' },
  ],
})

export const metadata: Metadata = {
  title: 'The Pure Food Co | Apps',
  description: 'TPFC Apps',
}

// No client-side auth gate here — proxy.ts already redirects any
// unauthenticated request to the shared Auth Hub before this layout ever
// renders (see CLAUDE.md), so every route under it can assume a signed-in
// user. AuthProvider still wraps children so useAuthUser()/useMe() can read
// that user's identity (display name, email) for the UI.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={gilroy.variable}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
