import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-start gap-3 pt-16">
      <h1 className="text-headline font-semibold">Page not found</h1>
      <p className="text-body text-muted">This address doesn't match any page in J.A.R.V.I.S.</p>
      <Link to="/" className="text-body text-accent hover:underline">
        Go to Incidents
      </Link>
    </section>
  );
}
