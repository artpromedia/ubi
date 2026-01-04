/**
 * Landing Page Redirect
 *
 * Redirects to the main app dashboard.
 * In the future, this could be a marketing landing page for unauthenticated users.
 */

import { redirect } from "next/navigation";

export default function LandingPage() {
  // TODO: Check auth and show landing page for unauthenticated users
  redirect("/home");
}
