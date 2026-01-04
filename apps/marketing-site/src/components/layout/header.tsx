/**
 * Marketing Site Header
 */

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ChevronDown } from "lucide-react";
import { Button } from "@ubi/ui";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Ride", href: "/ride" },
  { name: "Eat", href: "/eat" },
  { name: "Deliver", href: "/deliver" },
  {
    name: "Partner",
    href: "#",
    children: [
      { name: "Drive with UBI", href: "/drive" },
      { name: "Restaurant Partner", href: "/restaurant" },
      { name: "Fleet Partner", href: "/fleet" },
      { name: "Merchant Partner", href: "/merchant" },
    ],
  },
  { name: "About", href: "/about" },
  { name: "Cities", href: "/cities" },
];

export function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        isScrolled
          ? "bg-white/95 backdrop-blur shadow-sm dark:bg-gray-900/95"
          : "bg-transparent"
      )}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ubi-green">
            <span className="text-lg font-bold text-white">UBI</span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden lg:flex lg:items-center lg:gap-8">
          {navigation.map((item) => (
            <div key={item.name} className="relative">
              {item.children ? (
                <button
                  onClick={() =>
                    setOpenDropdown(openDropdown === item.name ? null : item.name)
                  }
                  onMouseEnter={() => setOpenDropdown(item.name)}
                  onMouseLeave={() => setOpenDropdown(null)}
                  className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-ubi-green dark:text-gray-300"
                >
                  {item.name}
                  <ChevronDown className="h-4 w-4" />
                </button>
              ) : (
                <Link
                  href={item.href}
                  className="text-sm font-medium text-gray-700 hover:text-ubi-green dark:text-gray-300"
                >
                  {item.name}
                </Link>
              )}

              {/* Dropdown */}
              {item.children && (
                <AnimatePresence>
                  {openDropdown === item.name && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      onMouseEnter={() => setOpenDropdown(item.name)}
                      onMouseLeave={() => setOpenDropdown(null)}
                      className="absolute left-0 top-full mt-2 w-56 rounded-lg border border-gray-200 bg-white py-2 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                    >
                      {item.children.map((child) => (
                        <Link
                          key={child.name}
                          href={child.href}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                          {child.name}
                        </Link>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          ))}
        </div>

        {/* CTA Buttons */}
        <div className="hidden lg:flex lg:items-center lg:gap-4">
          <Button variant="ghost" asChild>
            <Link href="https://app.ubi.africa/login">Log in</Link>
          </Button>
          <Button asChild className="bg-ubi-green hover:bg-ubi-green/90">
            <Link href="https://app.ubi.africa/signup">Sign up</Link>
          </Button>
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="lg:hidden"
        >
          {isMobileMenuOpen ? (
            <X className="h-6 w-6" />
          ) : (
            <Menu className="h-6 w-6" />
          )}
        </button>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-gray-200 bg-white lg:hidden dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="space-y-1 px-4 py-4">
              {navigation.map((item) => (
                <div key={item.name}>
                  {item.children ? (
                    <>
                      <button className="flex w-full items-center justify-between py-2 text-base font-medium text-gray-900 dark:text-white">
                        {item.name}
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <div className="pl-4">
                        {item.children.map((child) => (
                          <Link
                            key={child.name}
                            href={child.href}
                            className="block py-2 text-sm text-gray-600 dark:text-gray-400"
                          >
                            {child.name}
                          </Link>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Link
                      href={item.href}
                      className="block py-2 text-base font-medium text-gray-900 dark:text-white"
                    >
                      {item.name}
                    </Link>
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-2 pt-4">
                <Button variant="outline" asChild className="w-full">
                  <Link href="https://app.ubi.africa/login">Log in</Link>
                </Button>
                <Button asChild className="w-full bg-ubi-green hover:bg-ubi-green/90">
                  <Link href="https://app.ubi.africa/signup">Sign up</Link>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
