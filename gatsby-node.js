const fetch = require("node-fetch");
const { createRemoteFileNode } = require(`gatsby-source-filesystem`);
const {
  importAndCreateImageNodes,
  importAndCreateThumbnailNode,
  getCompleteProductData,
  processProduct,
  createStoreFiltersNode,
  getItemDescription
} = require("./utils");

exports.sourceNodes = (
  { actions, createNodeId, createContentDigest, store, cache },
  configOptions
) => {
  const { createNode } = actions;
  const apiHost = "https://api.mercadolibre.com";
  const { site_id, username } = configOptions;
  if (!username) {
    console.log(
      "\n ⚠️  Please add a username to the gatsby-source-mercadolibre plugin configuration in /gatsby-config.js."
    );
    return;
  }
  if (!site_id) {
    console.log(
      "\n ⚠️  Please add a site_id to the gatsby-source-mercadolibre plugin configuration in /gatsby-config.js."
    );
    return;
  }

  // Gatsby adds a configOption that's not needed for this plugin, delete it
  delete configOptions.plugins;

  // Get list of products
  // Documentation: https://api.mercadolibre.com/sites/MLA/search?#options
  const userEndpoint = `${apiHost}/sites/${site_id}/search?nickname=${username}`;

  return fetch(userEndpoint)
    .then(async response => {
      const parsedInitialResponse = await response.json();
      const totalProducts = parsedInitialResponse.paging.total;
      const storeFilters = parsedInitialResponse.available_filters;
      const results = [...parsedInitialResponse.results]; // Initial results
      const allPages = [];

      // MercadoLibre paginates the results by 50
      // and offers the offset parameter to get
      // the consequent pages/products
      let offset = 50;
      const totalFetches = Math.ceil(totalProducts / 50);
      const remainingFetches = totalFetches - 1;
      for (let f = 0; f < remainingFetches; f++) {
        allPages.push(
          fetch(`${userEndpoint}&offset=${offset}`).then(async response => {
            const parsedResults = await response.json();
            const productsReceivedAmount = parsedResults.results.length;

            parsedResults && results.push(...parsedResults.results);
          })
        );
        offset = offset + 50;
      }
      return Promise.all(allPages).then(() => ({ results, storeFilters }));
    })
    .then(data => {
      const storeFilters = data.storeFilters;
      const productsReceived = data.results;
      if (productsReceived.length === 0) {
        console.log(
          `\n ⚠️ ️  Mercado Libre API returned 0 products. \n Check the configuration options and make sure the user has published products.`
        );
      } else {
        // Grab all the product data from the https://api.mercadolibre.com/items/:id` endpoint
        // Documentation: https://api.mercadolibre.com/items/#options
        console.log(
          "\x1b[36m",
          "notice",
          "\x1b[0m",
          "Importing from Mercado Libre..."
        );
        if (productsReceived.length > 50) {
          console.log(
            "\x1b[36m",
            "notice",
            "\x1b[0m",
            `Importing a lot of products (${
              productsReceived.length
            }). This may take a while.`
          );
        }
        if (productsReceived.length > 300) {
          console.log(
            "\x1b[36m",
            "notice",
            "\x1b[0m",
            "Limiting to 3 images per product."
          );
        }
        const allProducts =
          productsReceived &&
          productsReceived.map(productData => {
            return getCompleteProductData(productData.id)
              .then(async product => ({
                ...product,
                // itemID: GraphQL overrides the id field with its own number, so we use itemID to store the ML id
                itemID: product && product.id,
                // itemDescription: Comes from a different endpoint
                itemDescription: await getItemDescription(productData.id).then(
                  description => description && description.plain_text
                ),
                // itemImages: Process into the data layer the largest variation of each img
                itemImages: await importAndCreateImageNodes({
                  productName: product && product.title, // So we can apply a max limit
                  totalProducts: productsReceived.length, // So we can apply a max limit
                  productID: product && product.id,
                  productPictures: product && product.pictures,
                  store,
                  cache,
                  createNode
                }),
                // itemThumbnail: Make the first image given by product.pictures be the thumbnail
                itemThumbnail: await importAndCreateThumbnailNode({
                  productID: product && product.id,
                  thumbnail: product && product.pictures[0],
                  store,
                  cache,
                  createNode
                })
              }))
              .catch(error => {
                console.log("Error getting all product data ");
              });
          });

        return Promise.all(allProducts).then(results => ({
          results,
          storeFilters
        }));
      }
    })
    .then(data => {
      const storeFilters = data.storeFilters;
      const allProductsProcessed = data.results;
      console.log(
        "\x1b[36m",
        "notice",
        "\x1b[0m",
        allProductsProcessed.length,
        " products imported. Creating nodes..."
      );

      // Create Filters Node
      const filtersNode = createStoreFiltersNode(
        storeFilters,
        createNodeId,
        createContentDigest
      );
      createNode(filtersNode);

      // Create Products Nodes
      allProductsProcessed.forEach(async product => {
        const nodeData = await processProduct(
          product,
          createNodeId,
          createContentDigest
        );
        createNode(nodeData);
      });
    })
    .catch(err => {
      console.log(
        "\n ⚠️  There was a problem with gatsby-source-mercadolibre. Check this endpoint: ↳",
        userEndpoint
      );
      console.log(err);
    });
};
