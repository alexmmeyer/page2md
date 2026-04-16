---
title: "Travel Redirect API Key - Expedia Group Developer Hub"
sourceType: "url"
source: "https://developers.expediagroup.com/travel-redirect-api/api/resources/partner-api-key"
convertedAt: "2026-04-16T02:32:29.135Z"
---

# [Travel Redirect API Key](#travel-redirect-api-key)

Travel Redirect API Key is assigned and configured as part of the Travel Redirect API onboarding process

## [What is a Travel Redirect API Key?](#what-is-a-travel-redirect-api-key?)

The Travel Redirect API key is a case-sensitive, alphanumeric string that looks something like this:

X99X9X9-99XX-9XX9-X999-99XX99X9X999X

## [Where does a partner get the Travel Redirect API Key?](#where-does-a-partner-get-the-travel-redirect-api-key?)

An API Key will be sent to the partner as part of the API on boarding process.

## [How is the Travel Redirect API Key used?](#how-is-the-travel-redirect-api-key-used?)

The Travel Redirect API Key is required for accessing Travel Redirect APIs. The key is included in the header of each API request, and is used to authenticate the partner making the request. The standard Travel Redirect API Key authentication header element looks like this:

Key: X99X9X9-99XX-9XX9-X999-99XX99X9X999X

## [What does the Travel Redirect API Key do?](#what-does-the-travel-redirect-api-key-do?)

This key is a unique identifier that maps each API request to a single partner operating on a single Expedia brand on a single Expedia Point of Sale.

The string is always used in its complete form, and there is no situation where a partner would need to make any changes to the partner key, as use of the Travel Redirect API Key in an incomplete form will result in an API authentication error.

## [Keys and Deeplinks](#keys-and-deeplinks)

The deeplink structure returned in the API response is directly tied to the Travel Redirect API Key. The Expedia brand to which the deeplink is directed, the point of sale of the site, as well as the structure of the deeplink itself are all managed by the configuration of the Travel Redirect API Key.

## [Why was I assigned more than one Travel Redirect API key?](#why-was-i-assigned-more-than-one-travel-redirect-api-key?)

Partners using the Travel Redirect APIs will have at least one Travel Redirect API Key. If the partner is operating on multiple points of sale, and/or if the partner is operating on multiple Expedia brands, they should have a different Travel Redirect API key for each unique combination of brand and Point of Sale.

In that situation it is up to the partner to ensure that the correct key is used in the correct situation.

Did you find this page helpful?

YesNo

How can we improve this content?

Any suggestions?

Submit

Thank you for helping us improve!

[

Previous

API Explorer

PreviousPrevious Document

](https://developers.expediagroup.com/travel-redirect-api/api/resources/api-explorer)

[

Next

Travel Redirect API Password

NextNext Document

](https://developers.expediagroup.com/travel-redirect-api/api/resources/partner-api-password)

ON THIS PAGE

[

What is a Travel Redirect API Key?

](#what-is-a-travel-redirect-api-key?)

[

Where does a partner get the Travel Redirect API Key?

](#where-does-a-partner-get-the-travel-redirect-api-key?)

[

How is the Travel Redirect API Key used?

](#how-is-the-travel-redirect-api-key-used?)

[

What does the Travel Redirect API Key do?

](#what-does-the-travel-redirect-api-key-do?)

[

Keys and Deeplinks

](#keys-and-deeplinks)

[

Why was I assigned more than one Travel Redirect API key?

](#why-was-i-assigned-more-than-one-travel-redirect-api-key?)

[Privacy Statement](https://developers.expediagroup.com/travel-redirect-api/legal/privacy-policy) [Cookie Statement](https://developers.expediagroup.com/travel-redirect-api/legal/cookie-policy) [Terms of Use](https://developers.expediagroup.com/travel-redirect-api/legal/terms-of-use)

Expedia, Inc. is not responsible for content on external websites.  
© 2026 Expedia, Inc., an Expedia Group company. All rights reserved. Expedia and the Airplane Logo are trademarks or registered trademarks of Expedia, Inc. CST# 2029030-50.