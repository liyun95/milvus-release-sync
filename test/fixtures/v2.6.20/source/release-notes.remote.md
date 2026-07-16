We are excited to announce the release of Milvus v2.6.20! This release improves query scheduling and batching, index loading, filtering performance, streaming rebalancing, and observability. It also resolves correctness and reliability issues across JSON filtering, streaming recovery, text indexing, analyzer configuration, and GPU_CAGRA operations.

## Improvements

- Added named C++ thread-pool activity metrics and Grafana monitoring ([#50299](https://github.com/milvus-io/milvus/pull/50299))
- Improved QueryCoord scheduling by decoupling task dispatch from distribution polling to allow independent scheduling intervals ([#50774](https://github.com/milvus-io/milvus/pull/50774), [#50777](https://github.com/milvus-io/milvus/pull/50777))
- Improved QueryNode query batching by increasing the default NQ grouping limits for larger merged query batches ([#50859](https://github.com/milvus-io/milvus/pull/50859), [#50898](https://github.com/milvus-io/milvus/pull/50898))
- Improved index-loading resilience by safely completing pending range reads after partial failures ([#50937](https://github.com/milvus-io/milvus/pull/50937))
- Optimized VARCHAR primary-key population when loading sealed segments ([#51063](https://github.com/milvus-io/milvus/pull/51063))
- Improved filter execution performance by skipping null-bitmap processing for all-valid results ([#51067](https://github.com/milvus-io/milvus/pull/51067))
- Improved channel balancing by enabling the channel-level score balancer by default and introducing a safer default threshold for channel-exclusive mode ([#51132](https://github.com/milvus-io/milvus/pull/51132))
- Improved streaming rebalancing to trigger immediately when the primary resource group configuration changed ([#51147](https://github.com/milvus-io/milvus/pull/51147))
- Upgraded Knowhere to v2.6.17 to prevent GPU_CAGRA operations from failing with bad_optional_access under the default ef configuration ([#51209](https://github.com/milvus-io/milvus/pull/51209))

## Bug fixes

- Fixed incorrect JSON path filter results for missing, null, or type-mismatched values ([#50722](https://github.com/milvus-io/milvus/pull/50722), [#50723](https://github.com/milvus-io/milvus/pull/50723))
- Fixed an issue where Marisa string indexes could fail to upload or load when the local temporary directory was missing ([#50772](https://github.com/milvus-io/milvus/pull/50772))
- Fixed an issue where stale streaming writes could retry indefinitely after their target collection or partition was dropped ([#50849](https://github.com/milvus-io/milvus/pull/50849), [#50895](https://github.com/milvus-io/milvus/pull/50895))
- Fixed an issue where cluster-level load configuration could override user-specified collection replica settings without force override enabled ([#50860](https://github.com/milvus-io/milvus/pull/50860))
- Fixed an issue where analyzer runtime settings and YAML updates were not applied to the Rust analyzer layer ([#50998](https://github.com/milvus-io/milvus/pull/50998))
- Fixed an issue where StorageV2 text index builds could use incorrect paths for existing segment insert logs ([#51002](https://github.com/milvus-io/milvus/pull/51002))
- Fixed an issue where DumpMessages omitted transaction data messages and produced incomplete exports ([#51102](https://github.com/milvus-io/milvus/pull/51102))
- Fixed an issue where ARRAY containment expressions could return incorrect results for float literals ([#51130](https://github.com/milvus-io/milvus/pull/51130))
- Fixed an issue where filters on missing nested JSON values, failed JSON casts, or out-of-range array elements could return incorrect results instead of UNKNOWN ([#51135](https://github.com/milvus-io/milvus/pull/51135))
- Fixed an issue where streaming recovery could omit physical channels recorded in collection metadata and leave required WAL topics unavailable after startup ([#51144](https://github.com/milvus-io/milvus/pull/51144))

