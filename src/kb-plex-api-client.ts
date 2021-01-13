import axios, { AxiosInstance } from 'axios';
import { concat, get } from 'lodash';

type TKeyValue = { [key: string]: string | number };
interface IWindowOpen {
  (url?: string, target?: string, features?: string, replace?: boolean): Window | null;
}

export interface IChannel {
  number: number;
}
export interface IDvrDevice {
  key: string;
}

export interface IDvr {
  key: string;
  Device: IDvrDevice[];

}

export interface IOptions {
  appName: string;
  token: string;
  protocol?: string;
  host?: string;
  port?: number;

}
export class PlexApiClient {
  public appName: string;
  private httpClient: AxiosInstance;
  public token: string;
  private headers: { [key: string]: string };

  constructor(opts: IOptions) {
    this.appName = opts.appName;
    this.token = opts.token;

    this.headers = {
      'Accept': 'application/json',
      'X-Plex-Device': this.appName,
      'X-Plex-Device-Name': this.appName,
      'X-Plex-Product': this.appName,
      'X-Plex-Version': '0.1',
      'X-Plex-Client-Identifier': 'rg14zekk3pa5zp4safjwaa8z',
      'X-Plex-Platform': 'Chrome',
      'X-Plex-Platform-Version': '80.0'
    };

    this.httpClient = axios.create({
			timeout: 3000,
      baseURL: `${ opts.protocol || 'http' }://${ opts.host || '127.0.0.1' }:${ opts.port || 32400 }`,
			headers: {
				"X-Initialized-At": Date.now().toString()
			}
		});

    this.httpClient.interceptors.request.use((config) => {
      config.headers = {
        ...this.headers,
        ...config.headers
      };

      if (this.token) {
        config.headers['X-Plex-Token'] = this.token;
      }
      // Do something before request is sent
      return config;
    }, (error) => {
      // Do something with request error
      return Promise.reject(error);
    });

    this.httpClient.interceptors.response.use((response) => {
      const token = get(response.data, 'user.authToken');
      if (token) {
        this.token = token;
      }
      return response;
    }, (error) => Promise.reject(error));
  }

  private static authHeaders(appName = 'kbPlexApiClient') {
    return {
      'Accept': 'application/json',
      'X-Plex-Product': appName,
      'X-Plex-Version': 'Plex OAuth',
      'X-Plex-Client-Identifier': 'rg14zekk3pa5zp4safjwaa8z',
      'X-Plex-Model': 'Plex OAuth'
    };
  }

  static async webLogin(plex: Partial<IOptions>, open: IWindowOpen): Promise<PlexApiClient> {
    const headers = PlexApiClient.authHeaders(plex.appName);
    const { data } = await axios.post('https://plex.tv/api/v2/pins?strong=true', {}, { headers });
    open('https://app.plex.tv/auth/#!?clientID=rg14zekk3pa5zp4safjwaa8z&context[device][version]=Plex OAuth&context[device][model]=Plex OAuth&code=' + data.code + '&context[device][product]=Plex Web');

    return await PlexApiClient.waitForWindowResponse(plex, data);
  }

  static async waitForWindowResponse(plex: Partial<IOptions>, plexLogin: { id: string; }): Promise<PlexApiClient> {
    const headers = PlexApiClient.authHeaders(plex.appName);
    return new Promise((resolve, reject) => {
      let limit = 120000 // 2 minute time out limit
      const poll = 2000 // check every 2 seconds for token
      const interval = setInterval(async () => {
        const { data } = await axios.get(`https://plex.tv/api/v2/pins/${ plexLogin.id }`, { headers });
        limit -= poll;
        if (limit <= 0) {
          clearInterval(interval);
          reject(new Error('Timed Out. Failed to sign in a timely manner (2 mins)'));
        }

        if (data.authToken !== null) {
          clearInterval(interval);
          plex.token = data.authToken;
          const client = new PlexApiClient(plex as IOptions);
          const _res = await client.Get('/')
          data.name = _res.friendlyName;
          resolve(client);
        }
      }, poll);
    });
  }

  async SignIn(login: string, password: string) {
    const data = new FormData();
    data.append('user', JSON.stringify({ login, password }));
    const res = await this.httpClient.post('https://plex.tv/users/sign_in.json', { data });
    if (res.status !== 201) {
      throw new Error(`Plex 'SignIn' Error - Username/Email and Password is incorrect!.`);
    }

    const token = this.token;
    return { token };
  }

  async Get(path: string, optionalHeaders: TKeyValue = {}) {
    const res = await this.httpClient.get(path, { headers: optionalHeaders });
    if (res.status !== 200) {
      throw new Error(`Plex 'Get' request failed. URL: ${path}`);
    }

    return res.data.MediaContainer;
  }
  async Put(path: string, params: TKeyValue = {}, optionalHeaders: TKeyValue = {}) {
    const res = await this.httpClient.put(path, {}, { headers: optionalHeaders, params });

    if (res.status !== 200) {
      throw new Error(`Plex 'Get' request failed. URL: ${path}`);
    }

    return res.data;
  }

  async Post(path: string, params: TKeyValue = {}, optionalHeaders: TKeyValue = {}) {
    const res = await this.httpClient.put(path, {}, { headers: optionalHeaders, params });

    if (res.status !== 200) {
      throw new Error(`Plex 'Get' request failed. URL: ${path}`);
    }

    return res.data;
  }

  async GetDVRS() {
    const result = await this.Get('/livetv/dvrs');
    let dvrs = result.Dvr as IDvr[];
    dvrs = dvrs || [];
    return dvrs;
  }

  async refreshGuide(_dvrs: IDvr[]) {
    const dvrs = _dvrs || await this.GetDVRS();

    for (let i = 0; i < dvrs.length; i++) {
      try {
        await this.Post(`/livetv/dvrs/${dvrs[i].key}/reloadGuide`);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async refreshChannels(channels: IChannel[], _dvrs: IDvr[]) {
    const dvrs = typeof _dvrs !== 'undefined' ? _dvrs : await this.GetDVRS();
    const channelNumbers = channels.map((channel) => channel.number);
    const qs: TKeyValue = {};

    qs.channelsEnabled = channelNumbers.join(',');
    channelNumbers.forEach((channelNum) => {
      qs[`channelMapping[${ channelNum }]`] = channelNum;
      qs[`channelMappingByKey[${ channelNum }]`] = channelNum;
    });
    const devices = concat([], ...dvrs.map((dvr) => dvr.Device));

    await Promise.all(devices.map((device) => this.Put(`/media/grabbers/devices/${ device.key }/channelmap`, qs)));
  }
}
