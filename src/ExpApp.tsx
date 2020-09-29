import { Registry } from 'prom-client';
import * as Express from 'express';
import * as Querystring from 'querystring';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Container, Row, Col, Button, Table } from 'reactstrap';
import * as Cheerio from 'cheerio';
import { InmateCard } from './ui';
import { RawRecordProviderI } from './interfaces';

export default function ExpApp(sqliteFilepath:string, prom: Registry, rawRecords:RawRecordProviderI): Express.Application {
  const app = Express();

  app.get('/favicon.ico', ({}, res) => res.status(404).end());

  app.get('/metrics', ({}, res) => res.contentType('text/plain').send(prom.metrics()))

  app.get('/mugshot/:mugshotHash', async (req, res) => {
    const mugshotHash = req.params['mugshotHash'];
    const mugData = await rawRecords.getMugshotData(mugshotHash);
    if(!mugData){
      return res.status(404).end();
    }
    const imgTag = Cheerio.load(mugData);
    const imgSrc:string = imgTag('img').prop('src');
    // Check if src is a data URI
    if(typeof imgSrc !== 'string' || imgSrc.indexOf('data:') !== 0){
      // If not, return nothing
      return res.status(404).end();
    }
    const splitData = imgSrc.substr(5).split(';');
    const mimeType = splitData[0];
    const b64Data = splitData[1].substr(7); // Remove "base64," prefix 
    const imgBuff = Buffer.from(b64Data, 'base64');
    return res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': imgBuff.length,
      'Cache-control': 'public, max-age=31536000, immutable', // The content is dependent on the hash, so an eternal cache is fine
    })
    .end(imgBuff);
  })

  app.get('/download-database', ({}, res) => {
    return res.download(sqliteFilepath, 'jailbot.sqlite');
  })

  app.get('/batch-list', async (req, res, next) => {
    const pageSize = 10;
    const queryPage = Number(req.query['page']);
    // listPage is the human-friendly (starts at 1) page number
    // If a non-number is provided, it will use 1. If a value <= 0 is provided, it will also use 1
    const listPage = isNaN(queryPage) ? 1 : ( queryPage > 0 ? queryPage : 1 );
    const batches = await rawRecords.getBatches(pageSize, ((listPage - 1) * pageSize));

    const bodyHtml = renderToStaticMarkup(
      <div>
        <a href={[req.path, Querystring.stringify({...req.query,page:listPage - 1})].join('?')}><Button disabled={listPage==1}>Previous Page</Button></a>
        <a href={[req.path, Querystring.stringify({...req.query,page:listPage + 1})].join('?')}><Button disabled={batches.length < pageSize}>Next Page</Button></a>
        <br/>
        <Table striped bordered responsive>
          <thead>
            <tr><th>Batch Time</th></tr>
          </thead>
          <tbody>
            {batches.map(b => (
              <tr key={b.batch_id}>
                <td><a href={`/batch/${b.batch_id}`}>{b.time.toLocaleString()}</a></td>
              </tr>
            ))}
            { batches.length > 0 ? null : (
              <div>No records found</div>
            ) }
          </tbody>
        </Table>
      </div>
    )
    return res.send(pageTemplate.replace('{{{body}}}', bodyHtml));
  })

  app.get('/batch/:batchId', async (req, res) => {
    const batchId = req.params['batchId'];
    const batchRecords = await rawRecords.getRecordsByBatch(batchId);
    const bodyHtml = renderToStaticMarkup(
      <Row>
        <Col xs={12}>Inmates Booked: {batchRecords.length}</Col>
        {batchRecords.map(r => (
          <Col key={r.id} xs={12}>
            <InmateCard record={r}/>
          </Col>
        ))}
        { batchRecords.length > 0 ? null : (
          <div>No records found</div>
        ) }
      </Row>
    )
    return res.send(pageTemplate.replace('{{{body}}}', bodyHtml));
  })
  
  app.get('/*', async (req, res, next) => {
    const batches = await rawRecords.getBatches(10);
    const bodyHtml = renderToStaticMarkup(
      <div>
        Last updated: {batches[0].time.toLocaleString()}
        <br/>
        <a href={`/batch/${batches[0].batch_id}`}>Most Recent Batch</a>
      </div>
    )
    return res.send(pageTemplate.replace('{{{body}}}', bodyHtml));
  })

  return app;
}

import { Navbar, NavbarBrand, Nav, NavItem, NavLink } from 'reactstrap';

const templateBody = renderToStaticMarkup(
  <Container>
    <Row>
      <Col>
        <Navbar light color="light" expand="md">
          <NavbarBrand href="/">Jailbot</NavbarBrand>
          <Nav navbar>
            <NavItem>
              <NavLink href="/batch-list">Batch List</NavLink>
            </NavItem>
          </Nav>
        </Navbar>
      </Col>
    </Row>
    <Row>
      {'{{{body}}}'}
    </Row>
  </Container>
)

import config from './config';
const trackingHtml = `<script async src="${config.ackee.endpoint}/tracker.js" data-ackee-server="${config.ackee.endpoint}" data-ackee-domain-id="${config.ackee.domain_id}"></script>`;

const pageTemplate = `
<!DOCTYPE html>
<html>
<head>
  <title>Jailbot</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css" integrity="sha384-JcKb8q3iqJ61gNV9KGb8thSsNjpSL0n8PARn9HuZOnIxN0hoP+VmmDGMN5t9UJ0Z" crossorigin="anonymous">
  ${ config.ackee.endpoint && config.ackee.domain_id ? trackingHtml : '' }
</head>
<body>
  ${templateBody}
</body>
</html>
`.trim();
