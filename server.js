/**
 * Copyright 2019 Artificial Solutions. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *    http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const http = require('http');
const express = require('express');
const qs = require('querystring');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const TIE = require('@artificialsolutions/tie-api-client');
const {
  TENEO_ENGINE_URL,
  WEBHOOK_FOR_TWILIO,
  FIRST_INPUT_FOR_TENEO,
  LANGUAGE_STT,
  LANGUAGE_TTS,
  PORT
} = process.env;
const port = PORT || 1337;
const teneoApi = TIE.init(TENEO_ENGINE_URL);
const firstInput = FIRST_INPUT_FOR_TENEO || '';
const language_STT = LANGUAGE_STT || 'en-GB';
const language_TTS = LANGUAGE_TTS || 'en-GB';

// initialise session handler, to store mapping between twillio CallSid and engine session id
const sessionHandler = SessionHandler();

// initialize an Express application
const app = express();
var router = express.Router()

// Tell express to use this router with /api before.
app.use("/", router);

router.post("/", handleTwilioMessages(sessionHandler));


function handleTwilioMessages(sessionHandler) {
  return (req, res) => {

    var body = '';
    req.on('data', function (data) {
      body += data;
    });

    req.on('end', async function () {

      var post = qs.parse(body);
      var callId = post.CallSid;
      var textToSend = '';

      if (post.CallStatus == 'ringing') { // If first input of call, send default input to Teneo (blank here)
        textToSend = firstInput;
      } else if (post.CallStatus = 'in-progress' && post.SpeechResult) { // Spoken responses
        textToSend = post.SpeechResult;
      } else { // Unrecognized, send blank
        textToSend = '';
      }

      const teneoSessionId = sessionHandler.getSession(callId);
      const teneoResponse = await teneoApi.sendInput(teneoSessionId, { 'text': textToSend });

      sessionHandler.setSession(callId, teneoResponse.sessionId);

      console.log('Caller ID: ' + callId);
      if (textToSend) {
        console.log('Captured Input: ' + textToSend);
      }
      if (teneoResponse.output.text) {
        console.log('Spoken Output: ' + teneoResponse.output.text);
      }

      sendTwilioMessage(teneoResponse, res);
    });
  }
}


function sendTwilioMessage(teneoResponse, res) {

  const twiml = new VoiceResponse();
  var response = null;

  var customVocabulary = ''; // If the output parameter 'twilio_customVocabulary' exists, it will be used for custom vocabulary understanding.  This should be a string separated list of words to recognize
  if (teneoResponse.output.parameters.twilio_customVocabulary) {
    customVocabulary = teneoResponse.output.parameters.twilio_customVocabulary;
  }

  if (teneoResponse.output.parameters.twilio_endCall == 'true') { // If the output parameter 'twilio_endcall' exists, the call will be ended
    response = twiml.hangup();
  } else {
    console.log("Custom vocab: " + teneoResponse.output.parameters.twilio_customVocabulary);
    response = twiml.gather({
      language: language_STT,
      hints: customVocabulary,
      action: WEBHOOK_FOR_TWILIO,
      input: 'speech',
      speechTimeout: 1
    });

    response.say(teneoResponse.output.text);
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
}


/***
 * SESSION HANDLER
 ***/

function SessionHandler() {

  // Map the Twilio CallSid id to the teneo engine session id. 
  // This code keeps the map in memory, which is ok for testing purposes
  // For production usage it is advised to make use of more resilient storage mechanisms like redis
  var sessionMap = new Map();

  return {
    getSession: (userId) => {
      if (sessionMap.size > 0) {
        return sessionMap.get(userId);
      }
      else {
        return "";
      }
    },
    setSession: (userId, sessionId) => {
      sessionMap.set(userId, sessionId)
    }
  };
}

// start the express application
http.createServer(app).listen(port, () => {
  console.log('Twilio will send messages to this server on : ' + WEBHOOK_FOR_TWILIO + ':' + port);
});