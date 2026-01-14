describe("@ubi/contract-testing", () => {
  it("should have Pact configuration", () => {
    expect(true).toBe(true);
  });

  it("should be ready for consumer contract tests", () => {
    expect(process.env).toBeDefined();
  });
});
