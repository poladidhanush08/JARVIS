import { graphLayout } from "./graphLayout";
import type { Incident } from "./types";

test("layout marks root, impacted, healthy and active edges", () => {
  const g = {
    nodes: [
      { id: "api-gateway", tier: "gateway" },
      { id: "auth-service", tier: "service" },
      { id: "user-db", tier: "datastore" },
      { id: "order-service", tier: "service" },
    ],
    edges: [
      { source: "api-gateway", target: "auth-service" },
      { source: "auth-service", target: "user-db" },
      { source: "api-gateway", target: "order-service" },
    ],
  };
  const inc = {
    affected_services: ["api-gateway", "auth-service", "user-db"],
    root_cause_candidates: [{ service: "user-db" }],
  } as unknown as Incident;
  const l = graphLayout(g, inc);
  expect(l.nodes.find((n) => n.id === "user-db")!.status).toBe("root");
  expect(l.nodes.find((n) => n.id === "auth-service")!.status).toBe("impacted");
  expect(l.nodes.find((n) => n.id === "order-service")!.status).toBe("healthy");
  expect(l.edges.find((e) => e.target === "order-service")!.active).toBe(false);
  expect(l.edges.find((e) => e.target === "user-db")!.active).toBe(true);
  expect(l.nodes.find((n) => n.id === "user-db")!.y).toBe(300);
  expect(l.nodes.find((n) => n.id === "auth-service")!.x).toBe(-80);
  expect(l.nodes.find((n) => n.id === "order-service")!.x).toBe(80);
});
