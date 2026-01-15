/**
 * Marketing Site Footer
 */

"use client";

import {
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  Phone,
  Twitter,
  Youtube,
} from "lucide-react";
import Link from "next/link";

import { UbiLogo } from "@ubi/ui";

const footerLinks = {
  services: {
    title: "Services",
    links: [
      { name: "UBI Move", href: "/ride" },
      { name: "UBI Bites", href: "/eat" },
      { name: "UBI Send", href: "/deliver" },
      { name: "UBI Business", href: "/business" },
    ],
  },
  partner: {
    title: "Partner",
    links: [
      { name: "Drive with UBI", href: "/drive" },
      { name: "Restaurant Partner", href: "/restaurant" },
      { name: "Fleet Partner", href: "/fleet" },
      { name: "Merchant Partner", href: "/merchant" },
    ],
  },
  company: {
    title: "Company",
    links: [
      { name: "About Us", href: "/about" },
      { name: "Careers", href: "/careers" },
      { name: "Press", href: "/press" },
      { name: "Blog", href: "/blog" },
      { name: "Cities", href: "/cities" },
    ],
  },
  support: {
    title: "Support",
    links: [
      { name: "Help Center", href: "/help" },
      { name: "Safety", href: "/safety" },
      { name: "Contact Us", href: "/contact" },
      { name: "Terms of Service", href: "/terms" },
      { name: "Privacy Policy", href: "/privacy" },
    ],
  },
};

const socialLinks = [
  { name: "Facebook", href: "https://facebook.com/ubiafrica", icon: Facebook },
  { name: "Twitter", href: "https://twitter.com/ubi_africa", icon: Twitter },
  {
    name: "Instagram",
    href: "https://instagram.com/ubi.africa",
    icon: Instagram,
  },
  {
    name: "LinkedIn",
    href: "https://linkedin.com/company/ubiafrica",
    icon: Linkedin,
  },
  { name: "YouTube", href: "https://youtube.com/@ubiafrica", icon: Youtube },
];

const countries = [
  { name: "Nigeria", flag: "🇳🇬" },
  { name: "Kenya", flag: "🇰🇪" },
  { name: "South Africa", flag: "🇿🇦" },
  { name: "Ghana", flag: "🇬🇭" },
  { name: "Rwanda", flag: "🇷🇼" },
  { name: "Ethiopia", flag: "🇪🇹" },
];

export const Footer = () => {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-7xl px-4 py-16 lg:px-8">
        {/* Main footer content */}
        <div className="grid gap-8 lg:grid-cols-6">
          {/* Brand & contact */}
          <div className="lg:col-span-2">
            <div className="mb-6">
              <UbiLogo size={32} variant="white" />
            </div>
            <p className="mb-6 text-sm">
              Africa's mobility super-app. Book rides, order food, and send
              packages across the continent.
            </p>

            {/* Contact */}
            <div className="space-y-2 text-sm">
              <a
                href="mailto:hello@ubi.africa"
                className="flex items-center gap-2 hover:text-white"
              >
                <Mail className="h-4 w-4" />
                hello@ubi.africa
              </a>
              <a
                href="tel:+254700000000"
                className="flex items-center gap-2 hover:text-white"
              >
                <Phone className="h-4 w-4" />
                +254 700 000 000
              </a>
            </div>

            {/* Social links */}
            <div className="mt-6 flex gap-4">
              {socialLinks.map((social) => {
                const Icon = social.icon;
                return (
                  <a
                    key={social.name}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full bg-gray-800 p-2 transition-colors hover:bg-gray-700 hover:text-white"
                    aria-label={social.name}
                  >
                    <Icon className="h-5 w-5" />
                  </a>
                );
              })}
            </div>
          </div>

          {/* Link columns */}
          {Object.values(footerLinks).map((section) => (
            <div key={section.title}>
              <h3 className="mb-4 font-semibold text-white">{section.title}</h3>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.name}>
                    <Link href={link.href} className="text-sm hover:text-white">
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Countries */}
        <div className="mt-12 border-t border-gray-800 pt-8">
          <div className="flex flex-wrap items-center justify-center gap-4">
            {countries.map((country) => (
              <span
                key={country.name}
                className="flex items-center gap-1 text-sm"
              >
                <span>{country.flag}</span>
                <span>{country.name}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 border-t border-gray-800 pt-8">
          <div className="flex flex-col items-center justify-between gap-4 text-sm lg:flex-row">
            <p>
              &copy; {new Date().getFullYear()} UBI Africa. All rights reserved.
            </p>
            <div className="flex gap-6">
              <Link href="/terms" className="hover:text-white">
                Terms
              </Link>
              <Link href="/privacy" className="hover:text-white">
                Privacy
              </Link>
              <Link href="/cookies" className="hover:text-white">
                Cookies
              </Link>
              <Link href="/accessibility" className="hover:text-white">
                Accessibility
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
