// Round-6 rider UI leftovers, against the REAL client path. (1) A list that never loaded shows
// its own error — never "showing the last update"; a list that DID load and then failed to
// refresh keeps its rows under a stale banner whose copy matches the behaviour (actions stay
// available and are re-checked by the server). (2) The stop / destination picker searches
// places through GET /v1/locations/{autocomplete,place} when the server offers it, and falls
// back to dropping a pin when it answers 503 MAPS_NOT_CONFIGURED. (The advance-inbox REPLACE
// is asserted in bookForLater.test.tsx.)
import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { LaterHubContainer } from "../src/screens/marketplace/LaterHub";
import { PlacePickerSheet } from "../src/screens/marketplace/PlacePickerSheet";
import { installWire } from "./helpers/wire";
import { clearClients, renderApp } from "./helpers/render";
import { booking, scheduled } from "./helpers/mpFixtures";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: {} }),
}));
jest.mock("@ubi/mobile-core", () => ({
  ...jest.requireActual("@ubi/mobile-core"),
  track: jest.fn(),
}));

const LATER = TEST_IDS.mp.rider.later;
const PLACE = TEST_IDS.mp.rider.place;

afterEach(clearClients);

describe("Booked for later — a list that never loaded is an error, not 'last update'", () => {
  it("shows the loaded lists, a section error for the one that failed, and no stale banner", async () => {
    let seriesUp = false;
    installWire(
      (c) => {
        if (c.path === "/v1/mp/scheduled-requests")
          return { status: 200, json: { items: [scheduled()] } };
        if (c.path === "/v1/mp/advance-bookings")
          return { status: 200, json: { items: [booking()] } };
        if (c.path === "/v1/mp/recurring-templates")
          return seriesUp
            ? { status: 200, json: { items: [] } }
            : {
                status: 500,
                json: { code: "internal_error", message: "boom" },
              };
        return undefined;
      },
      { marketplace_rides: true },
    );
    renderApp(<LaterHubContainer />);
    await screen.findByTestId(dynamicTestId(LATER.booking, "bkg_1"));
    expect(
      screen.getByTestId(dynamicTestId(LATER.scheduled, "sr_1")),
    ).toBeTruthy();
    const err = screen.getByTestId(dynamicTestId(LATER.sectionError, "series"));
    expect(
      within(err).getByText("Couldn’t load your recurring journeys"),
    ).toBeTruthy();
    expect(screen.queryByText(/Showing the last update/)).toBeNull();
    expect(screen.queryByTestId(LATER.error)).toBeNull();
    expect(screen.queryByTestId(LATER.empty)).toBeNull();
    seriesUp = true;
    fireEvent.press(within(err).getByText("Try again"));
    await waitFor(() =>
      expect(
        screen.queryByTestId(dynamicTestId(LATER.sectionError, "series")),
      ).toBeNull(),
    );
  });

  it("a failed refresh of loaded lists keeps the rows under honest stale copy", async () => {
    let down = false;
    const wire = installWire(
      (c) => {
        if (down && c.path.startsWith("/v1/mp/")) return "offline";
        if (c.path === "/v1/mp/scheduled-requests")
          return { status: 200, json: { items: [scheduled()] } };
        if (c.path === "/v1/mp/advance-bookings")
          return { status: 200, json: { items: [] } };
        if (c.path === "/v1/mp/recurring-templates")
          return { status: 200, json: { items: [] } };
        return undefined;
      },
      { marketplace_rides: true },
    );
    const { queryClient } = renderApp(<LaterHubContainer />);
    await screen.findByTestId(dynamicTestId(LATER.scheduled, "sr_1"));
    down = true;
    await queryClient.refetchQueries({ queryKey: ["mp", "later"] });
    const banner = await screen.findByTestId(LATER.offline);
    expect(within(banner).getByText("Reconnecting…")).toBeTruthy();
    expect(
      within(banner).getByText(
        "Showing the last update from the server. Anything you do needs a connection and is checked against the latest state first.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId(dynamicTestId(LATER.scheduled, "sr_1")),
    ).toBeTruthy();
    expect(wire.calls.length).toBeGreaterThan(3);
  });
});

describe("Place picker — search when the server offers it, the pin otherwise", () => {
  const near = { lat: 6.45, lng: 3.43 };

  it("searches, resolves a result to its coordinates and NAME, and confirms", async () => {
    const onConfirm = jest.fn();
    const wire = installWire((c) => {
      if (c.path === "/v1/locations/autocomplete")
        return {
          status: 200,
          json: {
            success: true,
            predictions: [
              {
                place_id: "pl_falomo",
                main_text: "Falomo Shopping Centre",
                secondary_text: "Awolowo Road, Ikoyi",
                description: "Falomo Shopping Centre, Awolowo Road, Ikoyi",
              },
            ],
          },
        };
      if (c.path === "/v1/locations/place")
        return {
          status: 200,
          json: {
            success: true,
            place: {
              place_id: "pl_falomo",
              name: "Falomo Shopping Centre",
              formatted_address: "12 Awolowo Road, Ikoyi, Lagos",
              lat: 6.4412,
              lng: 3.4298,
              types: [],
            },
          },
        };
      return undefined;
    });
    renderApp(
      <PlacePickerSheet
        visible
        title="Add a stop"
        near={near}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    fireEvent.changeText(await screen.findByTestId(PLACE.search), "Falomo");
    const result = await screen.findByTestId(
      dynamicTestId(PLACE.result, "pl_falomo"),
    );
    const auto = wire.calls.find(
      (c) => c.path === "/v1/locations/autocomplete",
    )!;
    expect(auto.query).toEqual({ input: "Falomo", lat: "6.45", lng: "3.43" });
    fireEvent.press(result);
    await waitFor(() =>
      expect(screen.getByTestId(PLACE.label).props.value).toBe(
        "Falomo Shopping Centre",
      ),
    );
    expect(
      wire.calls.find((c) => c.path === "/v1/locations/place")!.query,
    ).toEqual({ place_id: "pl_falomo" });
    fireEvent.press(screen.getByTestId(PLACE.confirm));
    // The place's name — never its street address — travels with the coordinates.
    expect(onConfirm).toHaveBeenCalledWith({
      lat: 6.4412,
      lng: 3.4298,
      label: "Falomo Shopping Centre",
    });
  });

  it("falls back to the map pin when Maps isn't configured (503)", async () => {
    const onConfirm = jest.fn();
    installWire((c) =>
      c.path === "/v1/locations/autocomplete"
        ? {
            status: 503,
            json: {
              success: false,
              error: {
                code: "MAPS_NOT_CONFIGURED",
                message: "Location service not available",
              },
            },
          }
        : undefined,
    );
    renderApp(
      <PlacePickerSheet
        visible
        title="Add a stop"
        near={near}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    fireEvent.changeText(await screen.findByTestId(PLACE.search), "Falomo");
    expect(await screen.findByTestId(PLACE.searchUnavailable)).toBeTruthy();
    expect(screen.queryByTestId(PLACE.search)).toBeNull();
    fireEvent(screen.getByTestId(PLACE.map), "press", {
      nativeEvent: { coordinate: { latitude: 6.44, longitude: 3.43 } },
    });
    fireEvent.press(screen.getByTestId(PLACE.confirm));
    expect(onConfirm).toHaveBeenCalledWith({ lat: 6.44, lng: 3.43 });
  });
});
