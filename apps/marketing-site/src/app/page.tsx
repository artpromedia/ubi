/**
 * Marketing Site Home Page
 *
 * The main landing page for www.ubi.africa
 */

import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { CitiesSection } from "@/components/sections/cities";
import { CTASection } from "@/components/sections/cta";
import { DownloadSection } from "@/components/sections/download";
import { HeroSection } from "@/components/sections/hero";
import { HowItWorksSection } from "@/components/sections/how-it-works";
import { SafetySection } from "@/components/sections/safety";
import { ServicesSection } from "@/components/sections/services";
import { TestimonialsSection } from "@/components/sections/testimonials";

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
