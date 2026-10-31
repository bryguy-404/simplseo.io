const title = "SimplSEO | SEO Software for Small Business Owners";
const description = "SimplSEO helps small business owners understand SEO in plain English. See what's holding your site back and what to fix first, no agencies or confusing tools.";

export const metadata = {
  title,
  description,
  alternates: { canonical: "/home" },
  openGraph: {
    title,
    description,
    url: "/home",
    siteName: "SimplSEO",
    type: "website",
    locale: "en_US",
  },
  twitter: { card: "summary", title, description },
};

export default function HomeLayout({ children }) {
  return children;
}

