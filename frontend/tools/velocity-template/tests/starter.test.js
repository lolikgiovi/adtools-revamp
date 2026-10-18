import { DEFAULT_VELOCITY_CONTEXT, DEFAULT_VELOCITY_TEMPLATE } from "../starter.js";
import { renderVelocityTemplate } from "../service.js";

describe("Velocity starter document", () => {
  it("renders a structured JSON payload with nested and collection data", () => {
    const context = JSON.parse(DEFAULT_VELOCITY_CONTEXT);
    const rendered = JSON.parse(renderVelocityTemplate(DEFAULT_VELOCITY_TEMPLATE, context));

    expect(rendered.customer).toEqual(expect.objectContaining({ displayName: "Maya Putri", segment: "PRIORITY", active: true }));
    expect(rendered.account).toEqual(expect.objectContaining({ currency: "IDR", balance: 18750000.5 }));
    expect(rendered.summary).toEqual({ itemCount: 3, totalQuantity: 6, hasItems: true });
    expect(rendered.items).toHaveLength(3);
    expect(rendered.items[0]).toEqual(expect.objectContaining({ sku: "TRAVEL-001", category: "TRAVEL", tagCount: 2 }));
  });
});
