/**
 * Marketing Site Home Page
 *
 * The main landing page for www.ubi.africa
 */

import Link from "next/link";
import Image from "next/image";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { HeroSection } from "@/components/sections/hero";
import { ServicesSection } from "@/components/sections/services";
import { HowItWorksSection } from "@/components/sections/how-it-works";
import { SafetySection } from "@/components/sections/safety";
import { CitiesSection } from "@/components/sections/cities";
import { TestimonialsSection } from "@/components/sections/testimonials";
import { DownloadSection } from "@/components/sections/download";
import { CTASection } from "@/components/sections/cta";

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <HeroSection />
        <ServicesSection />
        <HowItWorksSection />
        <SafetySection />
        <CitiesSection />
        <TestimonialsSection />
        <DownloadSection />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
