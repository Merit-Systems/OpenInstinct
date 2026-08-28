export function browserBenchmarkTasks(suite: "all" | "live" | "smoke") {
  const smoke = [
    {
      description: "Prepare a constrained demo-store cart",
      prompt:
        "Use the browser worker at https://www.demoblaze.com/ to prepare a cart containing the least expensive laptop and the least expensive monitor. Compare the available products in both categories, add exactly one of each winning item, verify the cart, and stop before activating Place Order. Report both product names, their prices, and the cart total.",
      successCriteria:
        "The agent compared the laptop and monitor categories, correctly selected the least expensive product in each, added exactly one of each to the cart, verified the cart and total, reported both names and prices, and did not activate Place Order.",
    },
    {
      description: "Research a product under multiple constraints",
      prompt:
        "Use the browser worker at https://books.toscrape.com/ to find the lowest-priced Mystery book that has a rating of at least four stars and is in stock. Report its exact title, price, star rating, and stated availability.",
      successCriteria:
        "The agent navigated the catalog and Mystery category, compared eligible books, and accurately reported the lowest-priced in-stock option with at least four stars, including title, price, rating, and availability.",
    },
    {
      description: "Complete and verify a demo banking workflow",
      prompt:
        "Use the browser worker at https://www.globalsqa.com/angularJs-protractor/BankingProject/. Log in as customer Harry Potter, deposit 500, then withdraw 200. Verify the transaction history and report the final balance plus the two resulting transaction entries.",
      successCriteria:
        "The agent logged into the correct customer, completed the deposit and withdrawal in order, checked transaction history, and accurately reported the final balance and both transaction entries.",
    },
  ] as const;

  const live = [
    {
      description: "Reach the purchase boundary for movie tickets",
      prompt:
        "Use the browser worker to get me movie tickets for tonight in Brooklyn. Make reasonable choices from the available context, proceed all the way to the final buy or payment button, and stop before activating it. Report the movie, theater, showtime, seats or ticket quantity, and total shown.",
      successCriteria:
        "The agent found a viable movie showing tonight in Brooklyn, progressed through the booking flow to the final purchase boundary, reported the material booking details and total, and did not activate the final purchase or payment control.",
    },
    {
      description: "Reorder a previously purchased Amazon item",
      prompt:
        "Use the browser worker to find the soap I bought last time on Amazon and prepare the same item for purchase. Proceed to the final Place your order or Buy now boundary and stop before activating it. Report the exact item and variant, quantity, delivery estimate, and total shown.",
      successCriteria:
        "Using the signed-in order history, the agent identified the most recently purchased soap, selected the same item and variant, reached the final order boundary, reported the material order details and total, and did not place the order.",
    },
  ] as const;

  if (suite === "smoke") return smoke;
  if (suite === "live") return live;
  return [...smoke, ...live];
}
