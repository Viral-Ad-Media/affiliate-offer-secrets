import { redirect } from "next/navigation";

// /settings itself has no content now that each section is its own page — it just lands on the
// first one, so the sidebar's parent "Settings" entry stays clickable and every child route keeps
// a real, linkable URL.
export default function SettingsIndex() {
  redirect("/settings/profile");
}
