import fs from "fs";
import path from "path";
import YAML from "yamljs";

interface RedisManifest {
  spec: {
    template: {
      spec: {
        containers: Array<{
          name: string;
          volumeMounts?: Array<{ name: string; mountPath: string }>;
        }>;
        volumes?: Array<{ name: string; emptyDir?: Record<string, never> }>;
      };
    };
  };
}

const MANIFEST_PATH = path.resolve(
  __dirname,
  "../../../infra/k8s/redis-deployment.yaml",
);

describe("Redis Kubernetes manifest", () => {
  it("mounts the declared temporary and data volumes in the Redis container", () => {
    const manifest = YAML.parse(
      fs.readFileSync(MANIFEST_PATH, "utf-8"),
    ) as RedisManifest;
    const podSpec = manifest.spec.template.spec;
    const redisContainer = podSpec.containers.find(
      (container) => container.name === "redis",
    );

    expect(redisContainer).toBeDefined();
    expect(redisContainer?.volumeMounts).toEqual(
      expect.arrayContaining([
        { name: "tmp", mountPath: "/tmp" },
        { name: "data", mountPath: "/data" },
      ]),
    );
    expect(podSpec.volumes).toEqual(
      expect.arrayContaining([
        { name: "tmp", emptyDir: {} },
        { name: "data", emptyDir: {} },
      ]),
    );
  });
});
