---
title: "Travel Redirect API Key - Expedia Group Developer Hub"
sourceType: "url"
source: "https://developers.expediagroup.com/travel-redirect-api/api/resources/partner-api-key"
convertedAt: "2026-04-16T02:32:34.433Z"
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

This site uses cookies and similar tracking technology. As disclosed in our Privacy Statement, we and our partners may collect personal information and other data. By continuing to use our website, you accept our Privacy Statement and Terms of Service.  
  
[Privacy Statement](https://developers.expediagroup.com/docs/legal/privacy-policy)[Terms of Service](https://developers.expediagroup.com/docs/legal/terms-of-use)

![Company Logo](https://cdn.cookielaw.org/logos/8853b8d3-a74b-44c9-acf8-8281507d5cc3/fb410dce-518b-46c6-b255-c987dcab42dc/5d3453a8-1b23-49c7-98ae-caa853c10ca9/Expedia_Horizontal_Logo_Product_Full_Colour_Dark_Blue_RGB.png)

## Your Privacy Choices

Your Opt Out Preference Signal is Honored

-   ### How to Make Your Privacy Choices
    
-   ### Strictly Necessary Cookies
    
-   ### Do Not Sell or Share My Personal Information/Opt-Out of Targeted Advertising
    

#### How to Make Your Privacy Choices

You may elect to opt-out from the use of non-essential third-party cookies and any data sharing program with third parties that would be considered a sale under California or Nevada law or Targeted Advertising under Colorado, Connecticut, Virginia or Utah law. To do so, please click on the Do Not Sell or Share My Personal Information/Opt-Out of Targeted Advertising tab to the left.  
  
Keep in mind that:  
  
1\. You will still receive cookies that are essential to the function of the website;  
  
2\. You will still see advertising, but it will not be targeted and may not be relevant to you; and  
  
3\. We will still share your personal data with our service providers and travel suppliers to provide the services on our web site.  
  
In order to have your opt-out associated with your account, you must be logged in.  
  
  
[For more information, see our Privacy Statement](lp/lg-privacypolicy)

#### Strictly Necessary Cookies

Always Active

These cookies are necessary for the website to function and cannot be switched off in our systems. They are usually only set in response to actions made by you which amount to a request for services, such as setting your privacy preferences, logging in or filling in forms. You can set your browser to block or alert you about these cookies, but some parts of the site will not then work. These cookies do not store any personally identifiable information.

#### Do Not Sell or Share My Personal Information/Opt-Out of Targeted Advertising

 Do Not Sell or Share My Personal Information/Opt-Out of Targeted Advertising Status: Opt-In

Under certain Privacy laws, you may have the right to opt-out of the sale or sharing of your personal information with third parties or the right to opt-out of targeted advertising. The cookies described collect information for analytics and to personalize your experience with targeted ads. You may exercise your right to opt out of this data usage by using this toggle switch. If you opt out we will not be able to offer you personalised ads and will not sell nor share your personal information with third parties.  
  
If you have enabled privacy controls on your browser (such as a plugin), we consider that as a valid request to opt-out, and it will have the same effect as the switch above.

-   ##### Performance Cookies
    
     Switch Label label
    
    These cookies allow us to count visits and traffic sources so we can measure and improve the performance of our site. They help us to know which pages are the most and least popular and see how visitors move around the site. All information these cookies collect is aggregated and therefore anonymous. If you do not allow these cookies we will not know when you have visited our site, and will not be able to monitor its performance.
    

-   ##### Targeting Cookies
    
     Switch Label label
    
    These cookies may be set through our site by our advertising partners. They may be used by those companies to build a profile of your interests and show you relevant adverts on other sites. They do not store directly personal information, but are based on uniquely identifying your browser and internet device. If you do not allow these cookies, you will experience less targeted advertising.
    

Back Button

### Cookie List

Filter Button

Consent Leg.Interest

 checkbox label label

 checkbox label label

 checkbox label label

Clear

 checkbox label label

Apply Cancel

Confirm My Choices

[![Powered by Onetrust](https://cdn.cookielaw.org/logos/static/powered_by_logo.svg "Powered by OneTrust Opens in a new Tab")](https://www.onetrust.com/products/cookie-consent/)