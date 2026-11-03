import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { TripsProvider } from "./providers";
import { Nav } from "@/components/Nav";
import { ResetFirstVisit } from "@/components/ResetFirstVisit";

/* Café Terrace: Fraunces for display and headings, Source Sans for everything else. */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wanderlist",
  description:
    "Pack for the weather, get around on a bike. Packing lists built from fifteen years of weather for your dates, with live bikeshare counts at the docks nearest where you are staying.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /* suppressHydrationWarning because TripsProvider rewrites data-has-trips
       once the fetch resolves — the DOM is intentionally ahead of the server's
       output here, and React should accept it. */
    <html
      lang="en"
      /* "loading" until the provider knows. Trips come from Supabase now, so
         the answer isn't on the device and can't be settled before paint; the
         CSS gate hides both faces meanwhile rather than guessing wrong. */
      data-has-trips="loading"
      /* globals.css sets scroll-behavior: smooth for in-page step links. This
         tells Next that's deliberate, so it stops warning and stops applying it
         to route changes — gliding between anchors is nice, gliding on every
         navigation is not. */
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${fraunces.variable} ${sourceSans.variable} h-full antialiased`}
    >
      <head>
      </head>
      <body className="flex min-h-full flex-col bg-background text-ink">
        <ClerkProvider>
          <TripsProvider>
            <Nav />
            <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
              {children}
            </main>
            <footer className="mx-auto w-full max-w-5xl px-5 pb-8">
              <div className="border-t border-rule pt-3">
                <ResetFirstVisit />
              </div>
            </footer>
          </TripsProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
